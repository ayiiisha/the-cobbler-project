/* =========================================================
   tests.js — the Self-tests page
   ---------------------------------------------------------
   Loads the app's own scripts into a sandbox (a fake browser
   storage, a fake page and a clock the tests control) and checks
   what they do. Your real projects are never read or changed.

   To add a test:
     test("What it checks", async ({ core }) => {
       ...
       ok(condition, "what should be true");
       eq(actual, expected, "what they should be");
     });
   core is a fresh copy of projects-core.js for each test;
   load("media-core.js", env) loads another script into it.
   ========================================================= */
(() => {

  const $ = (id) => document.getElementById(id);
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });

  class Failure extends Error {}
  const ok = (cond, message) => { if (!cond) throw new Failure(message); };
  const eq = (actual, expected, message) => {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b) throw new Failure(`${message}: expected ${b}, got ${a}`);
  };


  /* =========================================================
     THE SANDBOX
     ========================================================= */

  function fakeStorage() {
    const map = new Map();
    return {
      getItem: (k) => map.has(k) ? map.get(k) : null,
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      key: (i) => [...map.keys()][i] ?? null,
      get length() { return map.size; },
      clear: () => map.clear(),
    };
  }

  // A fresh, separate world: storage, page, clock
  function makeEnv() {
    const clock = { t: 1_800_000_000_000 };
    class FakeDate extends Date {
      constructor(...args) { super(...(args.length ? args : [clock.t])); }
      static now() { return clock.t; }
    }
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      createElement: (t) => document.createElement(t),
      createElementNS: (ns, t) => document.createElementNS(ns, t),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      body: document.createElement("div"),
    });
    const env = {
      window: win, document: doc, localStorage: fakeStorage(), sessionStorage: fakeStorage(),
      Date: FakeDate, alert: () => {}, confirm: () => true, prompt: () => null,
      location: { pathname: "/pages/tests.html", hash: "", search: "", href: "" },
      history: { replaceState() {} }, navigator,
    };
    win.localStorage = env.localStorage;
    win.sessionStorage = env.sessionStorage;
    env.tick = (ms = 2000) => { clock.t += ms; };
    return env;
  }

  const sources = new Map();
  async function load(file, env, extra = {}) {
    if (!sources.has(file)) sources.set(file, await (await fetch(`../resources/js/${file}`, { cache: "no-store" })).text());
    // The shared helpers (util.js) come first in the sandbox, as on every page
    if (file !== "util.js" && !env.window.Cobbler) await load("util.js", env);
    const vars = { ...env, Cobbler: env.window.Cobbler, ...extra };
    delete vars.tick;
    const names = Object.keys(vars);
    new Function(...names, sources.get(file))(...names.map(n => vars[n]));
  }

  // Saves media the way the Media page does (moved transcripts without their words)
  const Projects_set = (M, media) => M.__core.setData("media", M.packMedia(media));
  // A second page on the same storage (same projects, same files)
  async function withMediaSharing(M, fs) {
    const env = { ...makeEnv(), localStorage: M.__env.localStorage };
    env.window.localStorage = env.localStorage;
    env.window.FileStore = fs;
    await load("projects-core.js", env);
    await load("media-core.js", env, { Projects: env.window.Projects });
    env.window.MediaCore.__core = env.window.Projects;
    env.window.MediaCore.__env = env;
    return env.window.MediaCore;
  }

  // A sandbox with projects-core.js loaded, a project made and your name set
  async function withCore() {
    const env = makeEnv();
    await load("projects-core.js", env);
    const core = env.window.Projects;
    core.setMe("Tester");
    core.create("Test project", { activate: true });
    return { env, core };
  }


  /* =========================================================
     TESTS: change tracking and merging
     ========================================================= */

  test("Saving stamps changes and records them in Activity", async () => {
    const { core, env } = await withCore();
    let r = core.getData("research", []);
    r.push({ id: "a", title: "A" }, { id: "b", title: "B" });
    core.setData("research", r);
    env.tick();
    r = core.getData("research");
    r[0].title = "A2";
    r.splice(1, 1);
    core.setData("research", r);
    const data = core.snapshot(core.activeId());
    eq(data.research[0]._mb, "Tester", "the edit is stamped with your name");
    ok(data._deleted.some(d => d.id === "b"), "the deletion is recorded");
    eq(core.activity().map(a => a.kind).sort(), ["added", "added", "deleted", "edited"], "activity lists each change");
  });

  test("Moving something to another list isn't a deletion", async () => {
    const { core } = await withCore();
    core.getData("drafts", []);
    core.setData("drafts", [{ id: "d", parts: [{ id: "p1", scenes: [{ id: "s", text: "x" }] }, { id: "p2", scenes: [] }] }]);
    const d = core.getData("drafts");
    d[0].parts[1].scenes.push(d[0].parts[0].scenes.pop());
    core.setData("drafts", d);
    const data = core.snapshot(core.activeId());
    ok(!(data._deleted || []).some(x => x.id === "s"), "no deletion is recorded for the moved scene");
    const merged = core.mergeData(data, JSON.parse(JSON.stringify(data))).data;
    eq(merged.drafts[0].parts[1].scenes.map(s => s.id), ["s"], "the scene survives a merge");
  });

  test("Deleting a page's last comment is recorded", async () => {
    const { core } = await withCore();
    core.getData("comments", {});
    core.setData("comments", { research: [{ id: "c1", text: "hi", replies: [] }] });
    const c = core.getData("comments");
    delete c.research;
    core.setData("comments", c);
    ok(core.snapshot(core.activeId())._deleted.some(d => d.id === "c1"), "the comment's deletion is recorded");
  });

  test("A page's stale copy doesn't overwrite changes that arrived", async () => {
    const { core } = await withCore();
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "A" }]);
    const copy = JSON.parse(JSON.stringify(core.getData("research")));
    const remote = core.snapshot(core.activeId());
    remote.research.push({ id: "sam", title: "From Sam", _mt: 9e15, _mb: "Sam" });
    core.replaceData(core.activeId(), remote);
    core.getData("research");                   // another script reads it
    copy.push({ id: "mine", title: "Mine" });
    core.setData("research", copy);
    eq(core.getData("research").map(x => x.id).sort(), ["a", "mine", "sam"], "both the page's and the arrived changes are kept");
  });

  test("Editing in place after changes arrive keeps their author", async () => {
    const { core } = await withCore();
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "A" }]);
    const remote = core.snapshot(core.activeId());
    remote.research.push({ id: "sam", title: "Sam's", _mt: 5, _mb: "Sam" });
    core.replaceData(core.activeId(), remote);
    const live = core.getData("research");
    live[0].title = "A edited";
    core.setData("research", live);
    const sam = core.getData("research").find(x => x.id === "sam");
    eq([sam._mb, sam._mt], ["Sam", 5], "Sam's item still has Sam's stamp");
  });

  test("Merging: one-sided changes, newer wins, deletions, word lists", async () => {
    const { core } = await withCore();
    const base = { research: [{ id: "r1", title: "Rent", status: "Unverified", tags: ["a", "x"] }, { id: "r2", title: "Gone there" }], tracker: { status: "Research" } };
    const mine = { research: [{ id: "r1", title: "Rent (mine)", status: "Unverified", tags: ["a", "x", "m"] }, { id: "r2", title: "Gone there" }], tracker: { status: "Editing", _mt: 1 } };
    const theirs = { research: [{ id: "r1", title: "Rent", status: "Verified", tags: ["a", "t"] }, { id: "r5", title: "New" }], tracker: { status: "Fact-check", _mt: 2 } };
    const { data, conflicts } = core.mergeData(mine, theirs, base);
    eq(data.research.map(r => r.id), ["r1", "r5"], "their deletion and their addition both apply");
    eq([data.research[0].title, data.research[0].status], ["Rent (mine)", "Verified"], "each side's one-sided change is kept");
    eq(data.research[0].tags, ["a", "m", "t"], "tags combine (with the one they removed gone)");
    eq(data.tracker.status, "Fact-check", "where both changed it, the newer change wins");
    eq(conflicts.length, 1, "that one difference is listed");
    eq(conflicts[0].path, ["tracker", "status"], "with where it is");
  });

  test("Something deleted is removed from a collaborator's copy unless changed since", async () => {
    const { core } = await withCore();
    const mine = { research: [{ id: "keep", _mt: 50 }], _deleted: [{ id: "old", key: "research", at: 100 }, { id: "keep", key: "research", at: 10 }] };
    const theirs = { research: [{ id: "old", _mt: 90 }, { id: "keep", _mt: 50 }] };
    const { data } = core.mergeData(mine, theirs);
    eq(data.research.map(r => r.id), ["keep"], "the deleted item goes; the one changed after its deletion stays");
  });

  test("A difference can be switched later by its path", async () => {
    const { core } = await withCore();
    const root = { research: [{ id: "r1", status: "Verified" }] };
    ok(core.setAtPath(root, ["research", { id: "r1" }, "status"], "Disputed"), "setAtPath succeeds");
    eq(root.research[0].status, "Disputed", "the value changed");
  });


  /* =========================================================
     TESTS: undo and redo
     ========================================================= */

  test("Undo puts things back; redo does them again", async () => {
    const { core, env } = await withCore();
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "A" }]);
    env.tick();
    core.setData("research", [{ id: "a", title: "A" }, { id: "b", title: "B" }]);
    env.tick();
    eq(core.undo().key, "research", "undo reports what it undid");
    eq(core.getData("research").map(x => x.id), ["a"], "undo removes the second note");
    core.redo();
    eq(core.getData("research").map(x => x.id), ["a", "b"], "redo brings it back");
  });

  test("Typing counts as one undo step", async () => {
    const { core, env } = await withCore();
    core.getData("tracker", {});
    core.setData("tracker", { notes: "h" });
    env.tick(300); core.setData("tracker", { notes: "he" });
    env.tick(300); core.setData("tracker", { notes: "hey" });
    env.tick();
    core.undo();
    eq(core.getData("tracker", undefined), undefined, "one undo removes the whole burst of typing");
  });

  test("Undo never throws away changes that arrived from collaborators", async () => {
    const { core, env } = await withCore();
    core.getData("research", []);
    core.setData("research", [{ id: "a" }]);
    env.tick();
    const remote = core.snapshot(core.activeId());
    remote.research.push({ id: "sam", _mt: 9e15 });
    core.replaceData(core.activeId(), remote);
    ok(!core.canUndo(), "the step for research is dropped once their changes arrive");
  });

  test("Undoing a deletion brings it back, even through a merge", async () => {
    const { core, env } = await withCore();
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "A" }]);
    env.tick();
    core.setData("research", []);
    env.tick();
    core.undo();
    const data = core.snapshot(core.activeId());
    const merged = core.mergeData(data, JSON.parse(JSON.stringify(data))).data;
    eq(merged.research.map(x => x.id), ["a"], "the restored note survives the deletion record");
  });


  /* =========================================================
     TESTS: read-only copies and storage
     ========================================================= */

  test("A read-only copy keeps comments and nothing else", async () => {
    const { core } = await withCore();
    const [p] = core.parseBackup({ app: "cobbler-project", kind: "share", readOnly: true, sharedBy: "Sam", projects: [{ name: "Shared", shareId: "s1", data: { research: [{ id: "a" }] } }] });
    const id = core.addImported([p]);
    core.switchTo(id);
    ok(core.isReadOnly(), "it's marked read-only");
    core.setData("research", []);
    eq(core.getData("research").map(x => x.id), ["a"], "other changes aren't saved");
    core.setData("comments", { research: [{ id: "c", text: "Source?" }] });
    eq(core.getData("comments").research.length, 1, "comments are saved");
    eq(core.findByShareId("s1"), id, "it keeps the original's share id, so comments can go back");
  });

  test("The storage meter adds up", async () => {
    const { core } = await withCore();
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "x".repeat(5000) }]);
    const info = core.storageInfo();
    ok(info.used > 5000 && info.limit > 0, "storage used is counted");
    ok(info.projects[0].keys.some(k => k.key === "research" && k.size > 5000), "the research notes are the biggest part");
  });


  test("Big projects are saved compressed and read back the same", async () => {
    const { core, env } = await withCore();
    const notes = Array.from({ length: 800 }, (_, i) => ({ id: `n${i}`, title: `Note ${i}`, text: "The council met on Tuesday to discuss the budget. ".repeat(3) }));
    core.getData("research", []);
    core.setData("research", notes);
    const raw = env.localStorage.getItem("cobblerProjects2");
    ok(raw.startsWith("LZ1:"), "it's stored compressed");
    const info = core.storageInfo();
    ok(info.compressed && info.stored < info.plain / 2, `stored ${info.stored} of ${info.plain} characters`);
    // A second page with the same storage reads it back
    const env2 = { ...makeEnv(), localStorage: env.localStorage };
    await load("projects-core.js", env2);
    eq(env2.window.Projects.getData("research").length, 800, "every note is there");
    eq(env2.window.Projects.getData("research")[799].title, "Note 799", "and unchanged");
  });

  test("Saved projects that can't be read are never overwritten", async () => {
    const env = makeEnv();
    env.localStorage.setItem("cobblerProjects2", "LZ1:not really compressed");
    await load("projects-core.js", env);
    env.window.Projects.getData("research", []);
    env.window.Projects.setData("research", [{ id: "a" }]);
    eq(env.localStorage.getItem("cobblerProjects2"), "LZ1:not really compressed", "what's saved is left alone");
  });


  test("Projects stay when the record of the active one is stale", async () => {
    const env = makeEnv();
    env.localStorage.setItem("cobblerProjects2", JSON.stringify({ activeId: "gone", projects: {
      p1: { name: "One", data: { research: [{ id: "a" }] } }, p2: { name: "Two", data: {} } } }));
    await load("projects-core.js", env);
    const core = env.window.Projects;
    eq(core.list().map(p => p.name), ["One", "Two"], "both projects are still there");
    eq(core.activeName(), "One", "the first one becomes active");
    eq(JSON.parse(env.localStorage.getItem("cobblerProjects2")).projects.p1.data.research.length, 1, "nothing was saved over them");
  });

  test("A page that edits in place but saves a tidied copy doesn't bring back what it removed", async () => {
    const { core, env } = await withCore();
    core.getData("ideas", []);
    core.setData("ideas", [{ id: "a", text: "A" }, { id: "b", text: "B" }]);
    env.tick();
    const live = core.getData("ideas");           // the stored list itself, as pages get it
    live.unshift({ id: "empty", text: "" });       // an empty card, added in place but never meant to be saved
    live[1].text = "A2";
    core.setData("ideas", live.filter(i => i.text.trim()));
    eq(core.getData("ideas").map(i => i.id), ["a", "b"], "the empty card isn't merged back in");
    eq(core.getData("ideas")[0].text, "A2", "the edit is kept");
  });

  test("Projects saved under the old name are moved, not lost", async () => {
    const env = makeEnv();
    env.localStorage.setItem("cobblerProjects", JSON.stringify({ activeId: "p1", projects: { p1: { name: "Old", data: { research: [{ id: "a" }] } } } }));
    await load("projects-core.js", env);
    eq(env.window.Projects.activeName(), "Old", "the old projects load");
    ok(env.localStorage.getItem("cobblerProjects2") && env.localStorage.getItem("cobblerProjects") == null, "and are moved to the new slot");
  });


  /* =========================================================
     TESTS: shot lists (shot-list.js)
     ========================================================= */

  test("Shot numbers follow the scenes; sums and CSV add up", async () => {
    const { env } = await withCore();
    await load("shot-list.js", env);
    const S = env.window.ShotList;
    eq(S.numbers([{ scene: "12" }, { scene: "12" }, { scene: "13" }]), ["12A", "12B", "13A"], "numbered scenes give 12A, 12B, 13A");
    eq(S.numbers([{ scene: "Kitchen" }, { scene: "" }]), ["1", "2"], "unnumbered scenes count 1, 2, 3");
    eq(S.numbers(Array.from({ length: 27 }, () => ({ scene: "4" })))[26], "4AA", "the 27th shot of a scene is AA");
    const shots = [{ scene: "2", seconds: "4", minutes: "15", done: true }, { scene: "10", seconds: "6", minutes: "30", done: false }, { scene: "2", seconds: "", minutes: "", done: false }];
    const t = S.totals(shots);
    eq([t.shots, t.done, t.seconds, t.minutes, t.scenes], [3, 1, 10, 45, 2], "totals: shots, done, seconds, minutes, scenes");
    eq([..."2,10,10A,3,,1".split(",")].sort(S.sceneOrder), ["1", "2", "3", "10", "10A", ""], "scenes sort by number, then letter, unnumbered last");
    const csv = S.csv({ shots: [{ scene: "1", size: "Close-up", description: 'Hands, "the" kettle', done: true }] });
    ok(csv.split("\r\n").length === 2 && csv.includes('CU') && csv.includes('"Hands, ""the"" kettle"') && csv.endsWith(",Done"), "CSV: header, short size, quoted field, Done");
  });

  test("Shots come in from storyboard frames and screenplay scenes", async () => {
    const { env } = await withCore();
    await load("shot-list.js", env);
    const S = env.window.ShotList;
    const fromBoard = S.shotsFromStoryboard({ id: "b1", frames: [
      { id: "f1", scene: "3", shot: "Wide", move: "Static", duration: 5, action: "The street", dialogue: "", sound: "Rain" },
      { id: "f2", scene: "3", shot: "extreme close up", move: "Dolly", duration: 2, action: "Her eyes", dialogue: "Go.", sound: "" }] });
    eq(fromBoard.map(s => [s.scene, s.size, s.move, s.seconds, s.storyboardRef.frameId]), [["3", "Wide", "Static", 5, "f1"], ["3", "Extreme close-up", "Dolly", 2, "f2"]], "scene, size, move, seconds and the frame link");
    eq(fromBoard[1].description, "Her eyes\n“Go.”", "action and dialogue make the description");
    eq(fromBoard[0].sound, "Rain", "sound comes across");
    const fromScript = S.shotsFromScreenplay({ elements: [
      { type: "scene", text: "INT. KITCHEN - NIGHT" }, { type: "action", text: "She waits." }, { type: "scene", text: "EXT. STREET – DAWN" }, { type: "scene", text: "   " }] });
    eq(fromScript.map(s => [s.scene, s.intExt, s.dayNight, s.size]), [["1", "INT", "Night", "Wide"], ["2", "EXT", "Dawn", "Wide"]], "one master shot per heading, with INT/EXT and time of day");
    eq(S.sizeFrom("Medium close-up"), "Medium close-up", "a known size stays");
    eq(S.sizeFrom("ots dirty single"), "Over the shoulder", "a hand-typed one is matched by keyword");
  });


  test("Shot list exports: scheduling CSV, running order, calendar file and call sheet", async () => {
    const { env, core } = await withCore();
    await load("shot-list.js", env, { Projects: core });   // (the call sheet reads the team and interviewees)
    const S = env.window.ShotList;
    core.getData("team", []); core.setData("team", [{ id: "t1", name: "Sam", roles: ["Director", "Camera"], phone: "0700", email: "sam@x.org" }]);
    core.getData("interviewees", []); core.setData("interviewees", [
      { id: "p1", name: "Ana", role: "Tenant", shootDate: "2026-11-02", shootTime: "09:00", location: "Flat 3", release: { status: "Signed" } },
      { id: "p2", name: "Bo", role: "Other day", shootDate: "2026-11-03", release: { status: "Not sent" } }]);
    const list = { id: "sl1", name: "Day 1", date: "2026-11-02", callTime: "08:00", wrapTime: "", location: "Flat 3", notes: "Lunch at 13:00", access: "Side gate", hospital: "St Mary's", weather: "Dry",
      shots: [{ id: "a", scene: "12", size: "Wide", angle: "", move: "", lens: "", description: "Master", intExt: "INT", dayNight: "Day", seconds: "20", minutes: "30", gear: "", sound: "", notes: "", done: true },
              { id: "b", scene: "12", size: "Close-up", angle: "", move: "", lens: "", description: "Kettle\nsteam", intExt: "INT", dayNight: "Day", seconds: "4", minutes: "15", gear: "Slider", sound: "", notes: "", done: false },
              { id: "c", scene: "13", size: "", angle: "", move: "", lens: "", description: "", intExt: "", dayNight: "", seconds: "", minutes: "", gear: "", sound: "", notes: "", done: false }] };
    const csv = S.schedulingCSV(list).split("\r\n");
    eq(csv[0].split(",").slice(0, 3), ["Scene", "Shot", "Shot Size"], "headings scheduling apps look for");
    eq(csv[1].split(",").slice(0, 3), ["12", "A", "Wide"], "scene number and shot letter in their own columns");
    ok(csv[2].includes('"Kettle\nsteam"') && csv[2].includes(",Kettle,"), "the description is kept whole, and its first line is the subject");
    ok(csv[1].endsWith(",Completed") && csv[2].endsWith(",Not shot"), "status words");
    eq(S.runningOrder(list), ["08:00", "08:30", "08:45"], "the running order adds each shot's minutes to the call time");
    const ics = S.calendarFile(list);
    eq((ics.match(/BEGIN:VEVENT/g) || []).length, 3, "the day plus a block for each timed shot");
    ok(ics.includes("DTSTART;VALUE=DATE:20261102") && ics.includes("DTSTART:20261102T083000") && ics.includes("DTEND:20261102T084500"), "dates and times in the calendar file");
    const blocks = S.callSheetBlocks(list);
    const table = (heading) => blocks[blocks.findIndex(b => b.t === "h2" && b.text.startsWith(heading)) + 1];
    eq(blocks[0].text, "Call sheet: Day 1", "titled");
    ok(blocks[2].items.some(([k, v]) => k === "Nearest hospital" && v === "St Mary's"), "the hospital is on it");
    eq(table("Crew").rows[0].slice(0, 2), ["Sam", "Director, Camera"], "the Team page's people are the crew");
    eq(table("Cast").rows.map(r => r[0]), ["Ana"], "only the people booked for that day");
    eq(table("Schedule").rows.length, 3, "every shot is on the schedule");
    ok(/8:00|08:00/.test(table("Schedule").rows[0][0]) && table("Schedule").rows[0][1] === "☑", "first shot at call time, ticked");
  });

  test("Shared helpers: dates, times and drag-to-reorder", async () => {
    const env = makeEnv();
    await load("util.js", env);
    const C = env.window.Cobbler;
    ok(/Oct/.test(C.formatDate("2026-10-20")) && /20/.test(C.formatDate("2026-10-20")) && /2026/.test(C.formatDate("2026-10-20")) && /Tue/.test(C.formatDate("2026-10-20", { weekday: true })), "an ISO date (in this computer's order), with or without the weekday");
    ok(/2026/.test(C.formatDate(Date.UTC(2026, 9, 20, 12))), "a time in ms works too");
    eq(C.formatDate(""), "", "nothing in, nothing out");
    ok(/2:00|14:00/.test(C.formatTime("14:00")), "a time of day");
    // Drag: the shared state records what's being dragged, and a drop calls back with both items
    const state = { item: null };
    const rows = [1, 2, 3].map(n => document.createElement("div"));
    const dropped = [];
    rows.forEach((row, i) => C.dragReorder(row, { state, item: i, onDrop: (moved, onto) => dropped.push([moved, onto]) }));
    const dt = { effectAllowed: "", setData() {} };
    rows[0].dispatchEvent(Object.assign(new Event("dragstart"), { dataTransfer: dt }));
    eq(state.item, 0, "dragging the first row");
    ok(rows[0].classList.contains("is-dragging"), "it's marked");
    const over = Object.assign(new Event("dragover", { cancelable: true }), { dataTransfer: dt });
    rows[2].dispatchEvent(over);
    ok(over.defaultPrevented && rows[2].classList.contains("is-drop"), "another row accepts the drop");
    rows[2].dispatchEvent(Object.assign(new Event("drop", { cancelable: true }), { dataTransfer: dt }));
    eq(dropped, [[0, 2]], "the drop says what moved and where");
    rows[0].dispatchEvent(new Event("dragend"));
    ok(state.item === null && !rows[0].classList.contains("is-dragging"), "cleared afterwards");
  });


  /* =========================================================
     TESTS: Excel files (xlsx-read.js)
     ========================================================= */

  // A small workbook built right here (an .xlsx is a ZIP of XML; zip.js writes stored ZIPs)
  async function makeWorkbook(env) {
    await load("zip.js", env);
    const xml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
    const files = [
      { name: "[Content_Types].xml", data: xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>') },
      { name: "xl/workbook.xml", data: xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="People" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>') },
      { name: "xl/_rels/workbook.xml.rels", data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>') },
      { name: "xl/sharedStrings.xml", data: xml('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><t>Age</t></si><si><t>Joined</t></si><si><r><t>A</t></r><r><t>na, "the" one</t></r></si><si><t>Bo</t></si></sst>') },
      { name: "xl/styles.xml", data: xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>') },
      { name: "xl/worksheets/sheet1.xml", data: xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="inlineStr"><is><t>Paid</t></is></c><c r="E1" t="str"><f>x</f><v>Seen</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>34</v></c><c r="C2" s="1"><v>45292</v></c><c r="D2" t="b"><v>1</v></c><c r="E2" s="2"><v>45292.4375</v></c></row>' +
        '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="C4" s="1"><v>45658</v></c><c r="D4" t="b"><v>0</v></c><c r="E4" t="e"><v>#DIV/0!</v></c></row>' +
        '</sheetData></worksheet>') },
      { name: "xl/worksheets/sheet2.xml", data: xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Just a note</t></is></c></row></sheetData></worksheet>') },
    ];
    const blob = env.window.Zip.create(files);
    return new File([blob], "people.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  test("Excel files: sheets, shared strings, numbers, dates, TRUE/FALSE, blanks", async () => {
    const env = makeEnv();
    await load("xlsx-read.js", env);
    const X = env.window.XlsxRead;
    ok(X.isExcel("data.XLSX") && X.isExcel("a.xlsm") && !X.isExcel("a.csv"), "which files count as Excel");
    const sheets = await X.read(await makeWorkbook(env));
    eq(sheets.map(s => s.name), ["People", "Notes"], "both sheets, in order");
    const rows = sheets[0].rows;
    eq(rows[0], ["Name", "Age", "Joined", "Paid", "Seen"], "the header row: shared, inline and formula strings");
    eq(rows[1], ['Ana, "the" one', "34", "2024-01-01", "TRUE", "2024-01-01 10:30"], "rich text, a number, a date, a boolean, a custom date-time format");
    eq(rows[2], ["Bo", "", "2025-01-01", "FALSE", ""], "a blank cell is empty, an error is missing, the gap row is dropped");
    const csv = X.toCSV(rows);
    eq(csv.split("\r\n")[1], '"Ana, ""the"" one",34,2024-01-01,TRUE,2024-01-01 10:30', "as CSV, quoted where needed");
  });


  /* =========================================================
     TESTS: the browser's database (IndexedDB)
     ========================================================= */

  // A sandbox whose projects live in a scratch database of their own
  let dbCount = 0;
  async function withDatabase(name, setup = () => {}) {
    const env = makeEnv();
    env.window.indexedDB = indexedDB;
    env.window.COBBLER_DB_NAME = name;
    setup(env);
    await load("projects-core.js", env);
    await env.window.Projects.ready;
    return env;
  }
  const scratchDB = () => `cobbler-tests-${Date.now()}-${++dbCount}`;
  async function dropDatabase(name, ...envs) {
    for (const env of envs) await env.window.Projects.closeStorage();
    await new Promise(resolve => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = () => resolve();
      setTimeout(resolve, 3000);
    });
  }
  const until = async (check, ms = 3000) => {
    const end = Date.now() + ms;
    while (!check() && Date.now() < end) await new Promise(r => setTimeout(r, 20));
    return check();
  };

  test("Projects are kept in the browser's database and read back by the next page", async () => {
    if (!window.indexedDB) return;
    const name = scratchDB();
    const a = await withDatabase(name);
    const core = a.window.Projects;
    eq(core.storageMode(), "indexeddb", "the database is in use");
    core.create("Database project", { activate: true });
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "A" }]);
    await core.flushed();
    eq(a.localStorage.getItem("cobblerProjects2"), null, "nothing goes to localStorage");
    const b = await withDatabase(name);
    eq(b.window.Projects.activeName(), "Database project", "the next page sees the project");
    eq(b.window.Projects.getData("research")[0].title, "A", "with its data");
    await dropDatabase(name, a, b);
  });

  test("An older localStorage save is moved into the database", async () => {
    if (!window.indexedDB) return;
    const name = scratchDB();
    const env = await withDatabase(name, (e) => e.localStorage.setItem("cobblerProjects2",
      JSON.stringify({ activeId: "p1", projects: { p1: { name: "Old", data: { research: [{ id: "a" }] } } } })));
    const core = env.window.Projects;
    eq(core.activeName(), "Old", "the old projects load");
    await core.flushed();
    eq(env.localStorage.getItem("cobblerProjects2"), null, "and the localStorage copy is removed once they're in the database");
    const again = await withDatabase(name);
    eq(again.window.Projects.getData("research").length, 1, "they read back from the database");
    await dropDatabase(name, env, again);
  });

  test("A change saved in one tab shows up in another", async () => {
    if (!window.indexedDB || typeof BroadcastChannel !== "function") return;
    const name = scratchDB();
    const a = await withDatabase(name);
    a.window.Projects.create("Shared", { activate: true });
    await a.window.Projects.flushed();
    const b = await withDatabase(name);
    let told = 0;
    b.document.addEventListener("projects-data-changed", () => told++);
    a.window.Projects.getData("ideas", []);
    a.window.Projects.setData("ideas", [{ id: "x", text: "From tab A" }]);
    await a.window.Projects.flushed();
    ok(await until(() => b.window.Projects.getData("ideas", [])[0]?.text === "From tab A"), "tab B has the change");
    ok(told >= 1, "and its pages were told to redraw");
    await dropDatabase(name, a, b);
  });


  /* =========================================================
     TESTS: transcripts and markers (media-core.js)
     ========================================================= */

  // In-memory stand-in for file-store.js (IndexedDB)
  function fakeFileStore() {
    const map = new Map();
    return {
      map,
      put: async (id, blob) => { map.set(id, blob); },
      get: async (id) => map.get(id),
      remove: async (id) => { map.delete(id); },
      keys: async () => [...map.keys()],
    };
  }

  async function withMedia(extra = {}) {
    const { env, core } = await withCore();
    Object.assign(env.window, extra);
    await load("media-core.js", env, { Projects: core });
    env.window.MediaCore.__core = core;
    env.window.MediaCore.__env = env;
    return env.window.MediaCore;
  }

  test("Moving a transcript to file storage: saved without its words, logged, read back", async () => {
    const fs = fakeFileStore();
    const M = await withMedia({ FileStore: fs });
    const media = M.loadMedia();
    const t = { id: "t1", title: "Interview", speakers: {}, clipName: "", segments: [{ start: 0, end: 4, speaker: "A", text: "We got the letter." }, { start: 5, end: 9, speaker: "B", text: "When?" }] };
    media.transcripts.push(t);
    await M.moveTranscript(t, "browser");
    Projects_set(M, media);
    const saved = M.__core.getData("media").transcripts[0];
    eq(saved.segments, [], "the project keeps no words");
    eq([saved.storage.where, saved.paragraphs, saved.length], ["browser", 2, 9], "where it is, and its counts");
    ok(fs.map.has(saved.storage.key), "the words are in file storage");
    eq(saved.storageLog.map(e => [e.where, e.by]), [["browser", "Tester"]], "the move is logged with who did it");
    // A fresh page: words appear once hydrated
    const M2 = await withMediaSharing(M, fs);
    eq(M2.loadMedia().transcripts[0].segments.length, 0, "not read yet");
    eq(await M2.hydrate(), [], "nothing missing");
    eq(M2.loadMedia().transcripts[0].segments[1].text, "When?", "the words are back");
    // And back into the project
    const media2 = M2.loadMedia();
    await M2.moveTranscript(media2.transcripts[0], "project");
    Projects_set(M2, media2);
    const back = M2.__core.getData("media").transcripts[0];
    eq([back.segments.length, back.storage, back.storageLog.length], [2, undefined, 2], "words inside the project again, both moves logged");
  });

  // A stand-in for a folder the person picked (File System Access API)
  function fakeFolder(name) {
    const files = new Map();
    const dir = (path) => ({
      name: path.split("/").pop() || name,
      getDirectoryHandle: async (n) => dir(`${path}/${n}`),
      getFileHandle: async (n, { create } = {}) => {
        const key = `${path}/${n}`.replace(/^\//, "");
        if (!create && !files.has(key)) throw new Error("not found");
        return {
          getFile: async () => new Blob([files.get(key)]),
          createWritable: async () => { let text = ""; return { write: async (t) => { text += t; }, close: async () => { files.set(key, text); } }; },
        };
      },
      queryPermission: async () => "granted", requestPermission: async () => "granted",
    });
    return Object.assign(dir(""), { name, files });
  }

  test("Moving a transcript to a folder (e.g. Google Drive): file written, place logged, read back from the folder", async () => {
    const fs = fakeFileStore();
    const M = await withMedia({ FileStore: fs });
    const folder = fakeFolder("Team Drive");
    const media = M.loadMedia();
    const t = { id: "t9", title: "Mayor: interview", speakers: {}, segments: [{ start: 0, end: 3, speaker: "", text: "No comment." }] };
    media.transcripts.push(t);
    await M.moveTranscript(t, "folder", { root: folder });
    Projects_set(M, media);
    const saved = M.__core.getData("media").transcripts[0];
    eq(saved.storage.folder, "Team Drive", "the folder's name is logged");
    eq(saved.storage.path, "Cobbler transcripts/Test project [" + M.__core.activeId() + "]/Mayor interview [t9].json", "and the file's path inside it");
    ok(folder.files.has(saved.storage.path), "the file is in the folder");
    eq(saved.storageLog[0].path, saved.storage.path, "the log says where");
    // This browser's copy is gone (e.g. cleared): read from the folder instead
    fs.map.clear();
    await fs.put(M.FOLDER_HANDLE, folder);
    const M2 = await withMediaSharing(M, fs);
    eq(await M2.hydrate(), [], "found in the folder");
    eq(M2.loadMedia().transcripts[0].segments[0].text, "No comment.", "the words are back");
    ok(fs.map.has(saved.storage.key), "and a copy is kept in file storage again");
  });

  test("A transcript whose words can't be found is reported, not lost", async () => {
    const fs = fakeFileStore();
    const M = await withMedia({ FileStore: fs });
    const media = M.loadMedia();
    media.transcripts.push({ id: "t1", title: "Lost", speakers: {}, segments: [], storage: { where: "browser", key: "tx-t1-x" } });
    Projects_set(M, media);
    eq(await M.hydrate(), ["Lost"], "its title is reported");
    ok(M.__core.getData("media").transcripts[0].storage.key === "tx-t1-x", "where it should be is kept");
  });

  test("Resolve subtitles: hour offset removed, speakers read", async () => {
    const M = await withMedia();
    const r = M.parseTranscript("1\n01:00:01,000 --> 01:00:04,000\n[Speaker 1] We got the letter.\n\n2\n01:00:05,000 --> 01:00:07,000\n[Speaker 2] When?\n", "a.srt");
    eq(r.shifted, 3600, "an hour is taken off");
    eq(r.segments.map(s => [s.start, s.speaker]), [[1, "Speaker 1"], [5, "Speaker 2"]], "times and speakers");
  });

  test("Text transcripts with frame timecodes and ranges", async () => {
    const M = await withMedia();
    const r = M.parseTranscript("00:00:01:12 - 00:00:05:00\nSpeaker 1\nHello there.", "a.txt");
    eq([r.segments[0].start, r.segments[0].end, r.segments[0].speaker], [1.5, 5, "Speaker 1"], "start, end and speaker");
  });

  test("Resolve markers from an EDL and a CSV", async () => {
    const M = await withMedia();
    const edl = M.parseMarkers("TITLE: T\nFCM: NON-DROP FRAME\n\n001  001      V     C        01:00:05:00 01:00:05:01 01:00:05:00 01:00:05:01  \n |C:ResolveColorRed |M:Fix audio |D:24\n", "m.edl", 24);
    eq(edl.markers.map(m => [m.at, m.color, m.name, m.duration]), [[3605, "Red", "Fix audio", 1]], "the EDL marker");
    const csv = M.parseMarkers('#,Name,Record In,Color,Notes\n1,"Intro, part",01:00:00:00,Green,a note', "m.csv", 24);
    eq(csv.markers.map(m => [m.at, m.color, m.name, m.note]), [[3600, "Green", "Intro, part", "a note"]], "the CSV marker");
  });


  /* =========================================================
     TESTS: screenplays (screenplay.js)
     ========================================================= */

  async function withScreenplay(elements, extra = {}) {
    const { env, core } = await withCore();
    core.setData("screenplays", [{ id: "sp", title: "T", elements: elements.map((e, i) => ({ id: e.id || `e${i}`, ...e })), ...extra }]);
    await load("screenplay.js", env, { Projects: core });
    return env.window.Screenplay;
  }

  test("Pages hold 54 lines and long speeches continue with (MORE) and (CONT'D)", async () => {
    const els = [{ type: "scene", text: "INT. ROOM - DAY" }];
    for (let i = 0; i < 12; i++) els.push({ type: "action", text: "Line of action that wraps onto a second line because it is quite long indeed, yes." });
    els.push({ type: "character", text: "SAM" }, { type: "dialogue", text: "Words ".repeat(160) });
    const SP = await withScreenplay(els);
    const pages = SP.paginate(SP.current());
    ok(pages.every(p => p.length <= 54), "no page is longer than 54 lines");
    ok(pages[0].some(l => l.text === "(MORE)"), "(MORE) at the bottom of the page");
    ok(pages[1][0].text === "SAM (CONT'D)", "(CONT'D) at the top of the next");
    ok(pages.slice(0, -1).every(p => { const last = [...p].reverse().find(l => l.text); return last.type !== "scene" && last.type !== "character"; }), "no page ends on a heading or a name");
  });

  test("Dual dialogue sits side by side", async () => {
    const SP = await withScreenplay([{ type: "scene", text: "INT. A - DAY" }, { type: "character", text: "MARIA" }, { type: "dialogue", text: "Hi." },
      { type: "character", text: "SAM", dual: true }, { type: "dialogue", text: "Hello." }]);
    const line = SP.paginate(SP.current())[0].find(l => l.type === "dual");
    ok(line && /MARIA\s{5,}SAM/.test(line.text), "both names on one line");
  });

  test("Fountain and Final Draft exports (with dual dialogue)", async () => {
    const SP = await withScreenplay([{ type: "scene", text: "INT. A - DAY" }, { type: "action", text: "Rain." }, { type: "character", text: "MARIA" },
      { type: "parenthetical", text: "(quietly)" }, { type: "dialogue", text: "Hi." }, { type: "character", text: "SAM", dual: true }, { type: "dialogue", text: "Hello." },
      { type: "transition", text: "CUT TO:" }]);
    const s = SP.current();
    const back = SP.fromFountain(SP.toFountain(s));
    eq(back.elements.map(e => [e.type, e.text, !!e.dual]), s.elements.map(e => [e.type, e.text, !!e.dual]), "Fountain comes back the same");
    const fdx = new DOMParser().parseFromString(SP.toFDX(s), "application/xml");
    ok(!fdx.querySelector("parsererror"), "the .fdx is valid XML");
    eq(fdx.querySelectorAll("DualDialogue Paragraph").length, 5, "both speeches (names, parenthetical, lines) are grouped for Final Draft");
  });

  test("Revision marks and scene lengths", async () => {
    const SP = await withScreenplay([{ type: "scene", text: "INT. A - DAY" }, { type: "action", text: "Changed.", rev: "r1" }, { type: "scene", text: "EXT. B - NIGHT" }, { type: "action", text: "Same." }],
      { revisions: [{ id: "r1", color: "Blue", date: "10/9/26" }] });
    const s = SP.current();
    const lines = SP.paginate(s)[0];
    eq(lines.filter(l => l.rev).map(l => l.text), ["Changed."], "only the changed line is marked");
    const scenes = SP.scenesOf(s);
    eq(scenes.map(x => [x.ie, x.place, x.time]), [["INT.", "A", "DAY"], ["EXT.", "B", "NIGHT"]], "headings are split for the breakdown");
    ok(scenes.every(x => x.eighths >= 1), "every scene is at least 1/8 page");
  });


  /* =========================================================
     TESTS: music, sharing
     ========================================================= */

  test("Sheet music note names follow the key", async () => {
    const { env, core } = await withCore();
    const M = { el: () => document.createElement("div"), newId: (p) => p + Math.random(), register() {}, list: () => [], saveList() {}, setStatus() {}, fill() {} };
    await load("music-songs.js", env, { Projects: core, window: Object.assign(env.window, { MusicPage: M }) });
    const sig = M.songsApi.keySignature;
    eq(sig("Db"), { B: "♭", E: "♭", A: "♭", D: "♭", G: "♭" }, "D♭ major has five flats");
    eq(sig("F#m"), { F: "♯", C: "♯", G: "♯" }, "F♯ minor has three sharps");
    eq(M.songsApi.transposeChord("D/F#", 2, false), "E/G#", "chords and bass notes move together");
  });

  test("“Changes since last share” shows the net change", async () => {
    const { env, core } = await withCore();
    await load("share.js", env, { Projects: core });
    core.getData("research", []);
    core.setData("research", [{ id: "a", title: "Kept" }, { id: "b", title: "Gone again" }]);
    env.tick();
    core.setData("research", [{ id: "a", title: "Kept" }]);
    const lines = env.window.ProjectShare.changesSince(core.activeId(), 0).groups.flatMap(g => g.lines);
    eq(lines, ["Added “Kept”"], "something added then deleted doesn't appear");
  });


  /* =========================================================
     RUNNING
     ========================================================= */

  async function runAll() {
    const list = $("tests-list");
    list.replaceChildren();
    $("tests-run").disabled = true;
    let passed = 0;
    const started = performance.now();
    for (const t of tests) {
      const li = document.createElement("li");
      li.className = "test-item is-running";
      li.textContent = t.name;
      list.append(li);
      try {
        await t.fn({});
        li.className = "test-item is-pass";
        passed++;
      } catch (err) {
        li.className = "test-item is-fail";
        const detail = document.createElement("span");
        detail.className = "test-detail";
        detail.textContent = err instanceof Failure ? err.message : `Error: ${err.message}`;
        if (!(err instanceof Failure)) console.error(`${t.name}:`, err);   // (the stack, for the developer tools)
        li.append(detail);
      }
    }
    const ms = Math.round(performance.now() - started);
    $("tests-summary").textContent = passed === tests.length
      ? `✓ All ${tests.length} tests passed (${ms} ms).`
      : `✗ ${tests.length - passed} of ${tests.length} failed. Details are under each one.`;
    $("tests-summary").className = `tool-group ${passed === tests.length ? "is-pass" : "is-fail"}`;
    $("tests-run").disabled = false;
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("tests-run").addEventListener("click", runAll);
    runAll();
  });
})();
