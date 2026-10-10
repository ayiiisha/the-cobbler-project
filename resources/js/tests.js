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
    const vars = { ...env, ...extra };
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


  test("Projects saved under the old name are moved, not lost", async () => {
    const env = makeEnv();
    env.localStorage.setItem("cobblerProjects", JSON.stringify({ activeId: "p1", projects: { p1: { name: "Old", data: { research: [{ id: "a" }] } } } }));
    await load("projects-core.js", env);
    eq(env.window.Projects.activeName(), "Old", "the old projects load");
    ok(env.localStorage.getItem("cobblerProjects2") && env.localStorage.getItem("cobblerProjects") == null, "and are moved to the new slot");
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
