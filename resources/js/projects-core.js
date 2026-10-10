/* =========================================================
   projects-core.js — where all project data lives
   ---------------------------------------------------------
   A "project" is one container for everything you make on the
   site. Each page saves its own data inside the active project
   under its own key, for example:

     project.data.resources  → the Resources page table
     project.data.notes      → a future Notes page

   This file has no buttons or layout. It only stores data and
   offers functions (the "Projects API") that other files call:

     Projects.getData("resources", [])   read this page's data
     Projects.setData("resources", rows) save this page's data

   Load order on each page:
     projects-core.js → header.js → project-ui.js → page scripts

   CHANGE TRACKING (for collaborators)
   Every save compares the page's data with what the page last
   read, and:
     • stamps each changed item in a list with _mt (when) and
       _mb (who: your name, Projects.me())
     • records deleted items in project.data._deleted
       [{ id, key, at, by }] so deletions reach collaborators
     • adds a line to project.data._activity [{ id, at, by, key, label, kind }]
   If the data changed underneath the page since it read it
   (a collaborator's changes arrived, or another tab saved), the
   page's own changes are merged in rather than overwriting.
   Projects.mergeData(mine, theirs, base) is the merge itself;
   share.js and sync.js use it too. Keys starting with "_" are
   bookkeeping, not page data.

   UNDO AND REDO
   Every save also records what it replaced (per browser tab, in
   sessionStorage); saves to the same thing within 1.5 seconds,
   like typing, count as one step. Projects.undo() / redo() put a
   page's data back (undo.js wires Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z
   and reloads the page). Changes that arrive from collaborators
   or another tab clear the steps for what they changed, so undo
   never throws their work away.
   ========================================================= */
(() => {

  /* ---------- Where projects are kept ----------
     IndexedDB, database "cobbler-projects": one record per project in the
     store "projects" (key: the project's id) and which one is active in
     "meta". It holds far more than the few megabytes of localStorage, where
     projects used to live (key cobblerProjects2; cobblerProjects before
     compression). An older save there is read once, written to IndexedDB
     and removed. If IndexedDB isn't available (some browsers block it for
     pages opened straight from the disk), localStorage is used as before,
     with big saves compressed to fit.

     Reading IndexedDB takes a moment, so the projects aren't ready the
     instant this file runs: Projects.ready is a promise that resolves when
     they are. boot.js waits for it before loading the page's scripts. */
  const DB_NAME = window.COBBLER_DB_NAME || "cobbler-projects";   // the self-tests use a scratch database
  const STORAGE_KEY = "cobblerProjects2";
  const OLD_STORAGE_KEY = "cobblerProjects";

  /* localStorage saves are compressed (lz-string, about 3–5 times smaller) once
     they're big enough for it to matter. "LZ1:" marks a compressed save;
     plain JSON (starting with "{") still loads, so older saves keep working. */
  const LZ_PREFIX = "LZ1:";
  const COMPRESS_FROM = 50_000;   // characters; smaller saves stay plain (quicker)
  const LZ_FILE = "vendor/lz-string/lz-string-1.5.0.min.js";   // next to js/, in resources/
  const OWN_SRC = document.currentScript?.src || "";
  let lzLoaded = null;
  const lz = () => {
    if (typeof LZString !== "undefined") return LZString;
    if (lzLoaded !== null) return lzLoaded || null;
    // A page without the lz-string <script> (e.g. an older copy the browser
    // cached): load it from next to this file, once, so saves still read
    lzLoaded = false;
    try {
      const request = new XMLHttpRequest();
      request.open("GET", new URL(`../${LZ_FILE}`, OWN_SRC || location.href).href, false);   // synchronous: needed before anything loads
      request.send();
      if (request.status === 200 || (request.status === 0 && request.responseText)) {
        lzLoaded = new Function(`${request.responseText}\nreturn LZString;`)() || false;
      }
    } catch {}
    return lzLoaded || null;
  };
  let unreadable = false;         // saved data we couldn't read: never save over it

  function encode(json) {
    if (json.length < COMPRESS_FROM || !lz()) return json;
    return LZ_PREFIX + lz().compressToUTF16(json);
  }
  function decode(raw) {
    if (raw == null) return null;
    if (raw.startsWith(LZ_PREFIX)) {
      if (!lz()) throw new Error("the compressor (lz-string) didn't load");
      const json = lz().decompressFromUTF16(raw.slice(LZ_PREFIX.length));
      if (!json) throw new Error("couldn't decompress the saved projects");
      return JSON.parse(json);
    }
    return JSON.parse(raw);
  }


  /* ---------- Small helpers ---------- */

  // A unique id for a new project, e.g. "plx4k2m9ab"
  const newId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Today's date as 2026-10-08 (used in backup file names)
  const today = () => new Date().toISOString().slice(0, 10);

  // Turns "My Zine!" into "my-zine" (safe for file names)
  const slug = (text) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

  const obj = (v) => v && typeof v === "object" && !Array.isArray(v);   // (isObject, below, is the same)


  /* ---------- Load saved projects (or start fresh) ---------- */

  /* A saved { activeId, projects } tidied up, or null if there's nothing usable in it.
     Whatever projects are there are kept, even if the record of which one is
     active is missing or points at a project that's gone (e.g. deleted in
     another tab): starting over would save an empty project on top of them. */
  function normalizeSaved(saved) {
    if (!saved || !obj(saved.projects)) return null;
    const ids = Object.keys(saved.projects).filter(id => obj(saved.projects[id]));
    if (!ids.length) return null;
    ids.forEach(id => {
      const p = saved.projects[id];
      if (typeof p.name !== "string") p.name = "Untitled";
      if (!obj(p.data)) p.data = {};
    });
    for (const id of Object.keys(saved.projects)) if (!ids.includes(id)) delete saved.projects[id];
    if (!ids.includes(saved.activeId)) saved.activeId = ids[0];
    return { activeId: saved.activeId, projects: saved.projects };
  }

  // The projects saved in localStorage (older versions of the app, or the fallback), or null
  function readLocal() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY); } catch {}
    if (raw == null) return null;
    try {
      return normalizeSaved(decode(raw));
    } catch (err) {
      // Something's saved but unreadable here: keep it safe rather than start over on top of it
      unreadable = true;
      console.error("projects-core.js: couldn't read the saved projects:", err);
      setTimeout(() => alert("Your projects couldn't be loaded on this page, so nothing will be saved here (to keep them safe). Try reloading; if it keeps happening, open Settings and download a backup."), 0);
      return null;
    }
  }

  // First visit: one project. If the old Resources table (from before projects existed) is there, move it in.
  function freshState() {
    let oldResources = [];
    try { oldResources = JSON.parse(localStorage.getItem("uploadedResources") || "[]"); } catch {}
    if (!Array.isArray(oldResources)) oldResources = [];
    const id = newId();
    return {
      activeId: id,
      projects: {
        [id]: {
          name: "My Project",
          description: "",
          created: Date.now(),
          updated: Date.now(),
          data: oldResources.length ? { resources: oldResources } : {},
        },
      },
    };
  }


  /* ---------- IndexedDB ---------- */

  const idb = window.indexedDB || null;
  let db = null;            // the open database (IndexedDB mode)
  let mode = "local";       // "idb" or "local"

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains("projects")) d.createObjectStore("projects");
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();   // let a newer version (or a delete) through
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB is blocked"));
      request.onblocked = () => reject(new Error("IndexedDB is blocked"));
    });
  }

  // One transaction; resolves when it has committed
  const transaction = (stores, kind, run) => new Promise((resolve, reject) => {
    const t = db.transaction(stores, kind);
    run(t);
    t.oncomplete = () => resolve();
    t.onerror = t.onabort = () => reject(t.error || new Error("the database couldn't be written"));
  });

  async function readDB() {
    const out = { projects: {}, activeId: null };
    await transaction(["projects", "meta"], "readonly", (t) => {
      const cursor = t.objectStore("projects").openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (c) { out.projects[c.key] = c.value; c.continue(); } };
      const meta = t.objectStore("meta").get("activeId");
      meta.onsuccess = () => { out.activeId = meta.result ?? null; };
    });
    return Object.keys(out.projects).length ? out : null;
  }

  // Writes these projects (as they are now), removes those, and records the active one
  const writeDB = (ids, removed) => transaction(["projects", "meta"], "readwrite", (t) => {
    const store = t.objectStore("projects");
    ids.forEach(id => { if (state.projects[id]) store.put(state.projects[id], id); });
    removed.forEach(id => store.delete(id));
    t.objectStore("meta").put(state.activeId, "activeId");
  });


  /* ---------- Save ----------
     saveState(ids, removed) says which projects changed (none given = all).
     In IndexedDB mode the writes are gathered and done a moment later, so
     several saves in a row become one; Projects.flushed() waits for them. */

  let state = null;         // everything, in memory: { activeId, projects: { id: project, ... } }
  let lastSaved = { plain: 0, stored: 0 };   // sizes of the last localStorage save, for Settings › Storage
  const dirty = new Set(), gone = new Set();
  let everything = false, flushScheduled = false, saveFailed = false, migrating = false;
  let writing = Promise.resolve();

  // Other tabs: told after each write, so they pick up the changes
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(DB_NAME) : null;

  function saveState(ids = null, removed = []) {
    if (unreadable || !state) return false;
    if (mode === "local") return saveLocal();
    if (ids === null) everything = true; else ids.forEach(id => dirty.add(id));
    removed.forEach(id => { gone.add(id); dirty.delete(id); });
    if (!flushScheduled) { flushScheduled = true; queueMicrotask(flush); }
    return true;
  }

  function flush() {
    flushScheduled = false;
    const ids = everything ? Object.keys(state.projects) : [...dirty];
    const removed = [...gone];
    everything = false; dirty.clear(); gone.clear();
    if (!ids.length && !removed.length) return;
    writing = writing.then(() => writeDB(ids, removed)).then(() => {
      if (migrating) {   // the old localStorage save is now in the database: free the space
        migrating = false;
        try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(OLD_STORAGE_KEY); } catch {}
      }
      try { channel?.postMessage({ type: "saved" }); } catch {}
    }, (err) => {
      console.error("projects-core.js: couldn't save:", err);
      if (!saveFailed) { saveFailed = true; alert("Couldn't save your changes to the browser's database. Back up your projects (Settings) and reload."); }
    });
  }

  function saveLocal() {
    try {
      const json = JSON.stringify(state);
      const stored = encode(json);
      localStorage.setItem(STORAGE_KEY, stored);
      if (localStorage.getItem(OLD_STORAGE_KEY) != null) localStorage.removeItem(OLD_STORAGE_KEY);   // moved
      lastSaved = { plain: json.length, stored: stored.length };
      return true;
    } catch {
      alert("Couldn't save. Browser storage is full or blocked. Settings › Storage shows what's using the space.");
      return false;
    }
  }

  /* Changes saved elsewhere (another tab): take the fresh copy, keeping this tab's project */
  function adopt(fresh) {
    const next = normalizeSaved(fresh);
    if (!next) return;
    const active = state?.activeId;
    // Undo steps for anything another tab changed would undo its work: drop them
    for (const [pid, p] of Object.entries(next.projects)) {
      for (const key of new Set([...Object.keys(p.data || {}), ...Object.keys(state?.projects[pid]?.data || {})])) {
        if (JSON.stringify(p.data?.[key]) !== JSON.stringify(state?.projects[pid]?.data?.[key])) dropHistory(pid, key);
      }
    }
    state = next;
    if (state.projects[active]) state.activeId = active;
    shadows.clear();   // filled in again as pages read
    document.dispatchEvent(new Event("projects-data-changed"));
  }
  channel?.addEventListener("message", async (event) => {
    if (event.data?.type !== "saved" || mode !== "idb") return;
    try { const fresh = await readDB(); if (fresh) adopt(fresh); } catch {}
  });
  window.addEventListener("storage", (event) => {
    if (mode !== "local" || event.key !== STORAGE_KEY || !event.newValue) return;
    try { adopt(decode(event.newValue)); } catch {}
  });


  /* ---------- Start ---------- */

  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });

  async function start() {
    if (idb) {
      try {
        db = await openDB();
        mode = "idb";
        state = normalizeSaved(await readDB());
        if (!state) {
          state = readLocal();            // an older save, to move across
          if (state) migrating = true;
        }
        if (!state) state = freshState();
        saveState();   // a first-visit project is stored right away; an older save is moved across
      } catch (err) {
        console.warn("projects-core.js: IndexedDB isn't available here, so projects are kept in localStorage:", err);
        db = null;
        mode = "local";
      }
    }
    if (mode === "local") {
      state = readLocal() || freshState();
      saveState();   // (not when what's saved couldn't be read: that's left alone)
    }
    resolveReady();
  }
  start();   // (without IndexedDB this finishes before the line below runs)


  /* ---------- Naming ---------- */

  // If "Zine" is taken, returns "Zine (2)", then "Zine (3)", ...
  function uniqueName(name) {
    const taken = new Set(Object.values(state.projects).map(p => p.name));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} (${n})`)) n++;
    return `${name} (${n})`;
  }


  /* ---------- Backup file download ---------- */

  // Makes the browser download `obj` as a .json file
  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* How many things a page has saved, for the project summaries:
       a list                          → its length       (e.g. 9 resources)
       a group of lists, like comments → all items added  (e.g. 5 comments over 2 pages)
       anything else (one record, like the tracker's details) → 1 */
  function countItems(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === "object") {
      const parts = Object.values(value);
      return parts.length && parts.every(Array.isArray)
        ? parts.reduce((sum, list) => sum + list.length, 0)
        : 1;
    }
    return 1;
  }

  /* =========================================================
     CHANGE TRACKING AND MERGING
     ========================================================= */

  // What each saved key is called on screen
  const KEY_NAMES = {
    tracker: "Project Tracker", team: "Team", research: "Research", interviewees: "Interviews",
    questions: "Interview questions", pitches: "Pitches", packaging: "Packaging", ideas: "Ideas",
    ideaColumns: "Ideas columns", calendarEvents: "Calendar", tasks: "Tasks", media: "Media & Transcripts",
    edits: "Text Edit", storyboards: "Storyboarder", zines: "Zine Planner", datasets: "Data Analysis",
    resources: "Resources", comments: "Comments", drafts: "Writing", storyBible: "Story bible",
    sourceLog: "Sources", recordsRequests: "Records requests", eventTimeline: "Event timeline",
    submissions: "Submissions", corrections: "Corrections", writingLog: "Writing goals",
    screenplays: "Screenplay", songs: "Songs", gigs: "Gigs", releases: "Releases", samples: "Sample clearances",
    claims: "Who's working on what", shotLists: "Shot List",
  };

  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  const STAMPS = new Set(["_mt", "_mb"]);
  const plain = (v) => JSON.stringify(v, (k, x) => STAMPS.has(k) ? undefined : x);
  const sameData = (a, b) => plain(a) === plain(b);
  const clone = (v) => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const listOfIds = (list) => list.length > 0 && list.every(x => isObject(x) && (typeof x.id === "string" || typeof x.id === "number"));
  const listOfWords = (list) => list.every(x => x == null || typeof x !== "object");

  // A readable name for one thing in a list
  const shorten = (t, n = 40) => { const s = String(t).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  function itemLabel(item) {
    if (!isObject(item)) return "";
    const text = item.title || item.name || item.label || item.text || item.file || item.question || item.venue || "";
    return text ? `“${shorten(text)}”` : "an item";
  }

  // Your name, for stamps and the activity feed (set under "I am" or "Your name")
  function me() {
    try { return localStorage.getItem("cobblerMe") || localStorage.getItem("commentAuthor") || ""; } catch { return ""; }
  }

  /* Compares what a page last saw with what it's saving: stamps changed
     items, and returns { events, deleted } for the activity feed and
     deletion records. Only the first level of lists makes events. */
  function trackChanges(key, before, after) {
    const now = Date.now(), by = me() || "Someone";
    const events = [], deleted = [];
    function walk(a, b, label, depth) {
      if (Array.isArray(b) && (listOfIds(b) || (!b.length && Array.isArray(a) && listOfIds(a)))) {
        const old = new Map((Array.isArray(a) ? a : []).filter(isObject).map(x => [x.id, x]));
        const kept = new Set();
        b.forEach(item => {
          if (!isObject(item) || item.id == null) return;
          kept.add(item.id);
          const prev = old.get(item.id);
          if (!prev) {
            item._mt = now; item._mb = by;
            if (depth === 0) events.push({ kind: "added", label: `${label} ${itemLabel(item)}`, id: item.id });
            return;
          }
          if (sameData(prev, item)) {
            // Unchanged (a page may have dropped the stamps when tidying the data): keep them
            if (prev._mt && !item._mt) { item._mt = prev._mt; item._mb = prev._mb; }
            return;
          }
          for (const k of Object.keys(item)) if (!STAMPS.has(k)) walk(prev[k], item[k], label, depth + 1);
          item._mt = now; item._mb = by;
          if (depth === 0) events.push({ kind: "edited", label: `${label} ${itemLabel(item)}`, id: item.id });
        });
        old.forEach((prev, id) => {
          if (kept.has(id)) return;
          deleted.push({ id, key, at: now, by });
          if (depth === 0) events.push({ kind: "deleted", label: `${label} ${itemLabel(prev)}`, id });
        });
      } else if (isObject(a) && isObject(b)) {
        let changed = false;
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (STAMPS.has(k)) continue;
          const av = a[k], bv = b[k];
          // A list of things (or one that was emptied or removed, e.g. a page's last comment deleted)
          const isList = (Array.isArray(bv) && (listOfIds(bv) || (Array.isArray(av) && listOfIds(av))))
                      || (bv === undefined && Array.isArray(av) && listOfIds(av));
          if (isList || isObject(bv)) walk(av, bv ?? [], key === "comments" ? `comments on ${k.replace(/-/g, " ")}:` : label, depth);
          else if (!sameData(av, bv)) changed = true;
        }
        if (changed && depth === 0) events.push({ kind: "edited", label });
      } else if (depth === 0 && !sameData(a, b)) {
        events.push({ kind: "edited", label });
      }
    }
    walk(before, after, KEY_NAMES[key] || key, 0);
    // Something moved (e.g. a scene to another chapter) isn't deleted: keep only ids that are gone everywhere
    const still = new Set();
    const collect = (v) => {
      if (Array.isArray(v)) v.forEach(collect);
      else if (isObject(v)) { if (v.id != null) still.add(v.id); Object.values(v).forEach(collect); }
    };
    collect(after);
    const gone = deleted.filter(d => !still.has(d.id));
    const moved = new Set(deleted.filter(d => still.has(d.id)).map(d => d.id));
    const feed = events.filter(e => !(e.kind === "deleted" && moved.has(e.id)))
      .map(e => e.kind === "added" && moved.has(e.id) ? { ...e, kind: "edited" } : e);
    return { events: feed, deleted: gone, by, now };
  }

  // Adds activity lines, joining repeats (same person, same thing) within 15 minutes
  function logActivity(project, key, events, by, now) {
    if (!events.length) return;
    const log = Array.isArray(project.data._activity) ? project.data._activity : [];
    events.forEach(e => {
      const last = log.find(x => x.by === by && x.label === e.label && x.kind === e.kind && now - x.at < 15 * 60 * 1000);
      if (last) last.at = now;
      else log.push({ id: "a" + now.toString(36) + Math.random().toString(36).slice(2, 6), at: now, by, key, label: e.label, kind: e.kind });
    });
    log.sort((a, b) => a.at - b.at);
    project.data._activity = log.slice(-400);
  }

  function recordDeleted(project, deleted) {
    if (!deleted.length) return;
    const list = Array.isArray(project.data._deleted) ? project.data._deleted : [];
    const seen = new Set(list.map(d => d.id));
    deleted.forEach(d => { if (!seen.has(d.id)) list.push(d); });
    project.data._deleted = list.slice(-3000);
  }

  /* Merges two versions of a project's data (or of one value).
     base = the last version both had, if known. Returns
     { data, conflicts: [{ where, field, mine, theirs, choice, apply(choice) }], added, removed }.
     Things changed on one side only are taken; both sides' new things
     are kept; where both changed the same field, the newer one (by _mt)
     wins by default, otherwise `prefer` ("mine" unless told). */
  function mergeData(mine, theirs, base = undefined, { prefer = "mine" } = {}) {
    const conflicts = [];
    let added = 0, removed = 0;
    const hasBase = base !== undefined;
    const stamp = (o) => isObject(o) ? Number(o._mt || o.updated || o.edited || 0) : 0;
    const TIME_KEYS = new Set(["updated", "edited", "modified", "_mt"]);

    function countTaken(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b)) return;
      const k = (x) => isObject(x) && "id" in x ? `id:${x.id}` : JSON.stringify(x);
      const ma = new Set(a.map(k)), mb = new Set(b.map(k));
      added += b.filter(x => !ma.has(k(x))).length;
      removed += a.filter(x => !mb.has(k(x))).length;
    }

    function value(a, b, c, where, field, pref, path = []) {
      if (b === undefined) {
        if (hasBase && c !== undefined && sameData(a, c)) { removed += 1; return undefined; }
        return a;
      }
      if (a === undefined) {
        if (hasBase && c !== undefined && sameData(b, c)) return undefined;
        added += Array.isArray(b) ? b.length : 1;
        return clone(b);
      }
      if (sameData(a, b)) return stamp(b) > stamp(a) ? clone(b) : a;
      if (hasBase && c !== undefined) {
        if (sameData(a, c)) { countTaken(a, b); return clone(b); }
        if (sameData(b, c)) return a;
      }
      if (Array.isArray(a) && Array.isArray(b)) {
        if ((listOfIds(a) || !a.length) && (listOfIds(b) || !b.length)) return byId(a, b, Array.isArray(c) ? c : undefined, where, pref, path);
        if (listOfWords(a) && listOfWords(b)) {
          const old = Array.isArray(c) ? c : null;
          const keep = a.filter(x => !old || b.some(y => sameData(x, y)) || !old.some(y => sameData(x, y)));
          const extra = b.filter(x => !keep.some(y => sameData(x, y)) && !(old && old.some(y => sameData(x, y))));
          added += extra.length;
          removed += a.length - keep.length;
          return [...keep, ...extra];
        }
      }
      if (isObject(a) && isObject(b)) {
        const newer = stamp(a) || stamp(b) ? (stamp(b) > stamp(a) ? "theirs" : "mine") : pref;
        const old = isObject(c) ? c : undefined;
        const out = {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if (TIME_KEYS.has(k)) { out[k] = Math.max(Number(a[k]) || 0, Number(b[k]) || 0) || a[k] || b[k]; continue; }
          if (k === "_mb") { out[k] = stamp(b) > stamp(a) ? b[k] : a[k]; continue; }
          const v = value(a[k], b[k], old ? old[k] : undefined, where, k, newer, [...path, k]);
          if (v === undefined) continue;
          out[k] = v;
          if (v && typeof v === "object" && v.__conflict) {
            const conflict = v.__conflict;
            conflict.apply = (choice) => { conflict.choice = choice; out[k] = clone(choice === "mine" ? conflict.mine : conflict.theirs); };
            conflict.apply(conflict.choice);
          }
        }
        return out;
      }
      const choice = a === "" || a == null ? "theirs" : b === "" || b == null ? "mine" : (pref || "mine");
      const conflict = { where, field, mine: a, theirs: b, choice, path };
      conflicts.push(conflict);
      return { __conflict: conflict };
    }

    function byId(a, b, c, where, pref, path) {
      const find = (list, id) => list?.find(x => isObject(x) && x.id === id);
      const out = [];
      a.forEach(x => {
        const v = value(x, find(b, x.id), find(c, x.id), `${where} › ${itemLabel(x)}`, "", pref, [...path, { id: x.id }]);
        if (v !== undefined) out.push(v);
      });
      b.forEach(y => {
        if (find(a, y.id)) return;
        const v = value(undefined, y, find(c, y.id), where, "", pref, [...path, { id: y.id }]);
        if (v !== undefined) out.push(v);
      });
      return out;
    }

    const wrap = !isObject(mine) || !isObject(theirs);   // merging one value, not a whole project
    const A = wrap ? { v: mine } : mine, B = wrap ? { v: theirs } : theirs, C = wrap ? (hasBase ? { v: base } : undefined) : base;
    const data = {};
    for (const k of new Set([...Object.keys(A || {}), ...Object.keys(B || {})])) {
      if (k === "_deleted" || k === "_activity") {
        // Bookkeeping lists only ever grow
        const all = new Map();
        [...(Array.isArray(A[k]) ? A[k] : []), ...(Array.isArray(B[k]) ? B[k] : [])].forEach(x => { if (x?.id != null && !all.has(x.id)) all.set(x.id, x); });
        data[k] = [...all.values()].sort((x, y) => (x.at || 0) - (y.at || 0)).slice(k === "_deleted" ? -3000 : -400);
        continue;
      }
      const v = value(A?.[k], B?.[k], hasBase ? C?.[k] : undefined, KEY_NAMES[k] || k, "", prefer, wrap ? [] : [k]);
      if (v === undefined) continue;
      data[k] = v;
      if (v && v.__conflict) {
        const conflict = v.__conflict;
        conflict.apply = (choice) => { conflict.choice = choice; data[k] = clone(choice === "mine" ? conflict.mine : conflict.theirs); };
        conflict.apply(conflict.choice);
      }
    }
    if (!wrap) removed += pruneDeleted(data);
    return { data: wrap ? data.v : data, conflicts, added, removed };
  }

  /* Removes things recorded as deleted (unless changed after the deletion) */
  function pruneDeleted(data) {
    const gone = new Map((Array.isArray(data._deleted) ? data._deleted : []).map(d => [d.id, d]));
    if (!gone.size) return 0;
    let n = 0;
    const walk = (v, key) => {
      if (Array.isArray(v)) {
        for (let i = v.length - 1; i >= 0; i--) {
          const x = v[i];
          const d = isObject(x) && x.id != null ? gone.get(x.id) : null;
          if (d && (!d.key || d.key === key) && (Number(x._mt) || 0) < d.at) { v.splice(i, 1); n++; continue; }
          walk(x, key);
        }
      } else if (isObject(v)) Object.values(v).forEach(x => walk(x, key));
    };
    for (const [k, v] of Object.entries(data)) if (!k.startsWith("_")) walk(v, k);
    return n;
  }

  /* A place inside data, from a merge difference's path: ["research", { id: "r1" }, "status"] */
  function getAtPath(root, path) {
    let node = root;
    for (const seg of path) {
      if (node == null) return undefined;
      node = typeof seg === "object" ? (Array.isArray(node) ? node.find(x => isObject(x) && x.id === seg.id) : undefined) : node[seg];
    }
    return node;
  }
  function setAtPath(root, path, value) {
    const parent = getAtPath(root, path.slice(0, -1));
    const last = path[path.length - 1];
    if (parent == null || typeof last === "object") return false;
    parent[last] = value;
    return true;
  }

  /* What each page last read or saved, per project and key (JSON), so a
     save can tell the page's own changes from changes made underneath it.
     Only the first read counts (later reads, often by other scripts on the
     page, mustn't hide changes that arrived since); every save updates it. */
  const views = new Map();
  const viewKey = (id, key) => `${id}\u0000${key}`;
  const fallbacks = new Map();   // the fallback a page read for a key that had nothing saved (JSON)
  function remember(id, key, value) {
    if (key.startsWith("_")) return;
    try { views.set(viewKey(id, key), value === undefined ? undefined : JSON.stringify(value)); } catch {}
  }

  /* ---------- Undo and redo ---------- */

  const HISTORY_KEY = "cobblerUndo";
  const MAX_STEPS = 60;
  const history = (() => {
    try { const h = JSON.parse(sessionStorage.getItem(HISTORY_KEY)); if (h && Array.isArray(h.undo)) return h; } catch {}
    return { undo: [], redo: [] };
  })();
  let frozen = false;     // after an undo, until the page reloads: no more saves

  function persistHistory() {
    for (;;) {
      try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); return; }
      catch {
        // Full: drop the oldest steps until it fits
        if (history.undo.length) history.undo.shift();
        else if (history.redo.length) history.redo.shift();
        else return;
      }
    }
  }

  // before = JSON of the value the save replaced (null: there wasn't one)
  function recordStep(id, key, before) {
    if (before !== null && before.length > 1_500_000) return;   // too big to keep (e.g. huge transcripts)
    const now = Date.now();
    const last = history.undo[history.undo.length - 1];
    if (last && last.id === id && last.key === key && now - last.at < 1500) last.at = now;   // one step while typing
    else history.undo.push({ id, key, before, at: now });
    while (history.undo.length > MAX_STEPS) history.undo.shift();
    history.redo = [];
    persistHistory();
  }

  function dropHistory(id, key) {
    const keep = (s) => !(s.id === id && s.key === key);
    const count = history.undo.length + history.redo.length;
    history.undo = history.undo.filter(keep);
    history.redo = history.redo.filter(keep);
    if (history.undo.length + history.redo.length !== count) persistHistory();
  }

  // Puts a stored value back (undo/redo), tracked like any change so it reaches collaborators
  function restore(id, key, value) {
    const project = state.projects[id];
    if (!project) return false;
    const current = project.data[key];
    const { events, deleted, by, now } = trackChanges(key, current === undefined ? undefined : clone(current), value);
    recordDeleted(project, deleted);
    logActivity(project, key, events, by, now);
    if (value === undefined) delete project.data[key]; else project.data[key] = value;
    project.updated = Date.now();
    remember(id, key, value);
    shade(id, key, value);
    saveState([id]);
    document.dispatchEvent(new Event("projects-saved"));
    return true;
  }

  function stepHistory(from, to) {
    const entry = from.pop();
    if (!entry) return null;
    const project = state.projects[entry.id];
    if (!project) { persistHistory(); return stepHistory(from, to); }
    const now = project.data[entry.key];
    to.push({ ...entry, before: now === undefined ? null : JSON.stringify(now), at: 0 });
    restore(entry.id, entry.key, entry.before === null ? undefined : JSON.parse(entry.before));
    persistHistory();
    return { key: entry.key, label: KEY_NAMES[entry.key] || entry.key, project: project.name, projectId: entry.id };
  }

  /* What's actually stored, per project and key (JSON), as of the last read,
     save or arrival of changes. Pages that edit the stored objects in place
     are compared with this, so changes that arrived aren't taken as theirs. */
  const shadows = new Map();
  function shade(id, key, value) {
    if (key.startsWith("_")) return;
    try { shadows.set(viewKey(id, key), value === undefined ? undefined : JSON.stringify(value)); } catch {}
  }

  function writeData(id, key, value) {
    const project = state.projects[id];
    if (!project || frozen) return;
    if (project.readOnly && key !== "comments") {
      // A read-only copy shared for feedback: only comments are kept
      document.dispatchEvent(new CustomEvent("projects-read-only", { detail: { id, key } }));
      return;
    }
    if (key.startsWith("_")) { project.data[key] = value; project.updated = Date.now(); saveState([id]); return; }

    const current = project.data[key];
    const seen = views.has(viewKey(id, key)) ? views.get(viewKey(id, key)) : undefined;
    const shadow = shadows.get(viewKey(id, key));
    // Edited in place (the page saves the stored object): compare with what was stored.
    // A separate copy: compare with what the page last saw.
    const before = current !== undefined && current === value
      ? (shadow !== undefined ? JSON.parse(shadow) : seen !== undefined ? JSON.parse(seen) : undefined)
      : seen !== undefined ? JSON.parse(seen) : (current !== undefined ? clone(current) : undefined);

    // Stamps, deletions, activity (only when we know what the page saw)
    if (before !== undefined || current === undefined) {
      const { events, deleted, by, now } = trackChanges(key, before, value);
      recordDeleted(project, deleted);
      logActivity(project, key, events, by, now);
    }

    // For undo: what this save replaces
    // (a page saving the very fallback it read, e.g. its default columns, changes nothing worth undoing)
    const replaced = current === undefined ? null : current === value ? shadow : JSON.stringify(current);
    const justTheFallback = current === undefined && fallbacks.get(viewKey(id, key)) === JSON.stringify(value);
    if (replaced !== undefined && replaced !== JSON.stringify(value) && !justTheFallback) recordStep(id, key, replaced);

    // Changed underneath the page? Merge the page's changes into what's there now.
    // "Underneath" means what's stored moved on since the page read or last saved
    // it (changes arrived from a collaborator, another tab or an undo), which the
    // shadow records. A page's own edits to the stored object don't count, so a
    // page that edits in place but saves a tidied copy isn't merged with itself
    // (which could bring back things it had just removed).
    const moved = shadow === undefined || shadow !== seen;
    let result = value;
    if (current !== undefined && current !== value && seen !== undefined && moved && JSON.stringify(current) !== seen) {
      result = mergeData(value, current, JSON.parse(seen), { prefer: "mine" }).data;
    }
    project.data[key] = result;
    project.updated = Date.now();
    remember(id, key, value);
    shade(id, key, result);
    saveState([id]);
    document.dispatchEvent(new Event("projects-saved"));   // e.g. sync.js syncs soon after
  }

  // The parts of a project that go into a backup file
  const forBackup = (p) => ({ name: p.name, description: p.description || "", archived: !!p.archived, ...(p.readOnly ? { readOnly: true, sharedBy: p.sharedBy || "" } : {}),
                              ...(p.shareId ? { shareId: p.shareId } : {}), data: p.data });


  /* =========================================================
     THE PROJECTS API
     ========================================================= */
  const Projects = {

    /* ----- Read the list ----- */

    // How many things a page has saved (see countItems above)
    countItems,

    /* ----- Loading and saving ----- */

    // Resolves once the saved projects have been read (boot.js waits for this before the page's scripts run)
    ready,
    // Resolves once every save so far has been written
    flushed() { if (flushScheduled) flush(); return writing; },
    /** Saves what's waiting, then lets go of the database (the self-tests tidy up with this). */
    async closeStorage() { await this.flushed(); db?.close(); db = null; try { channel?.close(); } catch {} },
    // "indexeddb" or "localStorage" (the fallback)
    storageMode: () => mode === "idb" ? "indexeddb" : "localStorage",

    /* Asks the page to redraw itself from what's stored now (after an undo, or
       changes that arrived). Page scripts listen for "projects-refresh" and set
       event.detail.handled; returns false if none did, so the caller can reload instead. */
    refresh(detail = {}) {
      const event = new CustomEvent("projects-refresh", { detail: { handled: false, ...detail } });
      document.dispatchEvent(event);
      return event.detail.handled === true;
    },

    // [{ id, name, archived }, ...] for menus
    list: () => Object.entries(state.projects).map(([id, p]) => ({ id, name: p.name, archived: !!p.archived })),

    activeId:   () => state.activeId,
    activeName: () => state.projects[state.activeId].name,


    /* ----- Page data (each page uses its own key) ----- */

    getData(key, fallback) {
      const value = state.projects[state.activeId].data[key];
      if (!views.has(viewKey(state.activeId, key))) remember(state.activeId, key, value);
      if (!shadows.has(viewKey(state.activeId, key))) shade(state.activeId, key, value);
      if (value === undefined) { try { fallbacks.set(viewKey(state.activeId, key), JSON.stringify(fallback)); } catch {} }
      return value === undefined ? fallback : value;
    },

    setData(key, value) {
      writeData(state.activeId, key, value);
    },

    // The same, for any project (not just the active one), e.g. the Project Tracker
    getDataFor(id, key, fallback) {
      const value = state.projects[id]?.data[key];
      if (state.projects[id] && !views.has(viewKey(id, key))) remember(id, key, value);
      if (state.projects[id] && !shadows.has(viewKey(id, key))) shade(id, key, value);
      return value === undefined ? fallback : value;
    },

    setDataFor(id, key, value) {
      writeData(id, key, value);
    },


    /* ----- Undo and redo (see undo.js) ----- */

    undo: () => stepHistory(history.undo, history.redo),
    redo: () => stepHistory(history.redo, history.undo),
    canUndo: () => history.undo.length > 0,
    canRedo: () => history.redo.length > 0,
    // Stops saving until the page reloads (after an undo, so stale pages can't save over it)
    freeze() { frozen = true; },


    /* ----- Storage (Settings › Storage) ----- */

    storageInfo() {
      const projects = Object.entries(state.projects).map(([id, p]) => {
        const keys = Object.entries(p.data).map(([key, v]) => ({ key, size: JSON.stringify(v ?? null).length,
          name: KEY_NAMES[key] || (key === "_activity" ? "Activity history" : key === "_deleted" ? "Deletion records" : key) }));
        return { id, name: p.name, size: keys.reduce((n, k) => n + k.size, 0), keys: keys.sort((a, b) => b.size - a.size) };
      }).sort((a, b) => b.size - a.size);
      const plain = JSON.stringify(state).length;
      if (mode === "local") {
        // localStorage: everything the site keeps there counts towards its 5 MB
        let used = 0;
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); used += k.length + (localStorage.getItem(k) || "").length; } } catch {}
        const stored = lastSaved.stored || encode(JSON.stringify(state)).length;
        return { where: "localStorage", used, limit: 5_000_000, projects, plain, stored, compressed: stored < plain };
      }
      // IndexedDB has no fixed ceiling of its own: Settings asks the browser (navigator.storage.estimate) for the real one
      return { where: "indexeddb", used: plain, limit: null, projects, plain, stored: plain, compressed: false };
    },

    // Shortens bookkeeping: activity older than `days`, deletion records older than twice that
    trimHistory(days = 90) {
      const cut = Date.now() - days * 86400000;
      for (const p of Object.values(state.projects)) {
        if (Array.isArray(p.data._activity)) p.data._activity = p.data._activity.filter(a => a.at > cut);
        if (Array.isArray(p.data._deleted)) p.data._deleted = p.data._deleted.filter(d => d.at > cut - days * 86400000);
      }
      saveState();
    },


    /* ----- Collaboration ----- */

    KEY_NAMES, itemLabel, mergeData, pruneDeleted, getAtPath, setAtPath,
    isReadOnly: (id = state.activeId) => !!state.projects[id]?.readOnly,
    readOnlyFrom: (id = state.activeId) => state.projects[id]?.sharedBy || "",
    // A read-only copy becomes a normal project (e.g. when you want to keep working on it yourself)
    makeEditable(id) {
      const p = state.projects[id];
      if (!p) return;
      delete p.readOnly; delete p.sharedBy; delete p.shareId;
      saveState([id]);
    },
    me,
    setMe(name) { try { localStorage.setItem("cobblerMe", String(name || "").trim()); } catch {} },

    // Recent activity in a project, newest first: [{ at, by, key, label, kind }]
    activity(id = state.activeId, { since = 0, by = null } = {}) {
      const log = state.projects[id]?.data._activity;
      return (Array.isArray(log) ? log : []).filter(a => a.at > since && (!by || a.by === by)).sort((a, b) => b.at - a.at);
    },

    // When this project was last shared from this browser (file, email or sync folder)
    lastShared: (id) => state.projects[id]?.lastShared || 0,
    markShared(id) {
      if (!state.projects[id]) return;
      state.projects[id].lastShared = Date.now();
      saveState([id]);
    },

    // Sync folder: whether this project syncs (this browser only)
    syncs: (id) => !!state.projects[id]?.sync,
    setSync(id, on) {
      if (!state.projects[id]) return;
      if (on) state.projects[id].sync = true; else delete state.projects[id].sync;
      saveState([id]);
    },

    // Every project's value for one key, e.g. all the "zines" lists.
    // Used to check whether an uploaded file is still used anywhere.
    collect(key) {
      return Object.values(state.projects)
        .map(p => p.data[key])
        .filter(value => value !== undefined);
    },


    /* ----- Details for the Projects page cards ----- */

    info() {
      return Object.entries(state.projects).map(([id, p]) => ({
        id,
        name: p.name,
        description: p.description || "",
        created: p.created,
        updated: p.updated || p.created,
        active: id === state.activeId,
        archived: !!p.archived,
        bytes: JSON.stringify(p.data).length,
        // e.g. [{ key: "resources", count: 9 }] (bookkeeping keys starting with "_" left out)
        summary: Object.entries(p.data).filter(([key]) => !key.startsWith("_")).map(([key, v]) => ({ key, count: countItems(v) })),
        shareId: p.shareId || null,
        readOnly: !!p.readOnly,
        sharedBy: p.sharedBy || "",
        lastShared: p.lastShared || 0,
        sync: !!p.sync,
      }));
    },


    /* ----- Create, switch, rename ----- */

    // Makes a new empty project and switches to it (unless activate is false).
    // Returns the new project's id.
    create(name, { description = "", activate = true } = {}) {
      const id = newId();
      state.projects[id] = {
        name: uniqueName(name.trim() || "Untitled"),
        description,
        created: Date.now(),
        updated: Date.now(),
        data: {},
      };
      if (activate) state.activeId = id;
      saveState([id]);
      return id;
    },

    // Opening an archived project brings it back out of the archive
    switchTo(id) {
      if (!state.projects[id]) return;
      state.activeId = id;
      delete state.projects[id].archived;
      saveState([id]);
    },


    /* ----- Archive (hide finished projects without deleting them) ----- */

    // Refuses the active project: switch to another one first. Returns true if it changed.
    setArchived(id, archived) {
      const project = state.projects[id];
      if (!project || (archived && id === state.activeId)) return false;
      if (archived) project.archived = true;
      else delete project.archived;
      saveState([id]);
      return true;
    },

    rename(name) { this.renameById(state.activeId, name); },

    renameById(id, name) {
      if (!state.projects[id]) return;
      state.projects[id].name = name.trim() || "Untitled";
      saveState([id]);
    },


    /* ----- Duplicate, delete ----- */

    duplicate(id) {
      const p = state.projects[id];
      if (!p) return null;
      const copyId = newId();
      state.projects[copyId] = {
        name: uniqueName(`${p.name} (copy)`),
        description: p.description || "",
        created: Date.now(),
        updated: Date.now(),
        data: JSON.parse(JSON.stringify(p.data)),   // a real copy, not a shared reference
      };
      saveState([copyId]);
      return copyId;
    },

    // Refuses to delete the last project (there must always be one)
    removeById(id) {
      if (!state.projects[id] || Object.keys(state.projects).length < 2) return false;
      delete state.projects[id];
      if (state.activeId === id) state.activeId = Object.keys(state.projects)[0];
      saveState([], [id]);
      return true;
    },

    removeActive() { return this.removeById(state.activeId); },


    /* ----- Sharing with collaborators (share.js) ----- */

    // The id every copy of a shared project keeps, so copies can be merged. Made the first time it's shared.
    shareIdOf(id, { create = false } = {}) {
      const p = state.projects[id];
      if (!p) return null;
      if (!p.shareId && create) { p.shareId = "s" + newId().slice(1); saveState([id]); }
      return p.shareId || null;
    },

    setShareId(id, shareId) {
      if (!state.projects[id] || !shareId) return;
      state.projects[id].shareId = shareId;
      saveState([id]);
    },

    // The project with this share id, if this browser has a copy
    findByShareId(shareId) {
      const matches = Object.entries(state.projects).filter(([, p]) => shareId && p.shareId === shareId);
      return (matches.find(([, p]) => !p.readOnly) || matches[0])?.[0] || null;   // the editable copy first
    },

    // A copy of everything in a project (for merging)
    snapshot(id) {
      const p = state.projects[id];
      return p ? JSON.parse(JSON.stringify(p.data)) : null;
    },

    // Replaces all of a project's data at once (after a merge)
    replaceData(id, data) {
      const p = state.projects[id];
      if (!p || !data || typeof data !== "object") return false;
      for (const k of new Set([...Object.keys(p.data), ...Object.keys(data)])) {
        if (JSON.stringify(p.data[k]) !== JSON.stringify(data[k])) dropHistory(id, k);
      }
      p.data = data;
      p.updated = Date.now();
      Object.keys(data).forEach(k => shade(id, k, data[k]));
      document.dispatchEvent(new CustomEvent("projects-data-changed", { detail: { id } }));
      return saveState([id]);
    },

    // Makes a project from someone else's synced copy; returns its id
    addFromShare({ name, description = "", shareId, data }) {
      const id = newId();
      state.projects[id] = { name: uniqueName(name || "Shared project"), description, created: Date.now(), updated: Date.now(), data, shareId, sync: true, lastShared: Date.now() };
      saveState([id]);
      return id;
    },


    /* ----- Backup (download .json files) ----- */

    backupById(id) {
      const p = state.projects[id];
      if (!p) return;
      downloadJSON(
        { app: "cobbler-project", version: 1, projects: [forBackup(p)] },
        `${slug(p.name)}-backup-${today()}.json`
      );
    },

    backupActive() { this.backupById(state.activeId); },

    backupAll() {
      downloadJSON(
        { app: "cobbler-project", version: 1, projects: Object.values(state.projects).map(forBackup) },
        `all-projects-backup-${today()}.json`
      );
    },


    /* ----- Import / restore (always adds NEW projects, never overwrites) ----- */

    // Checks a parsed backup file and returns its projects, or throws a readable error
    parseBackup(obj) {
      if (!obj || obj.app !== "cobbler-project" || !Array.isArray(obj.projects)) {
        throw new Error("This isn't a Cobbler Project backup file.");
      }
      const list = obj.projects
        .filter(p => p && typeof p.name === "string"
                       && p.data && typeof p.data === "object" && !Array.isArray(p.data))
        .map(p => ({
          name: p.name,
          description: typeof p.description === "string" ? p.description : "",
          archived: p.archived === true,
          ...(typeof p.shareId === "string" ? { shareId: p.shareId } : {}),
          ...(p.readOnly === true || obj.readOnly === true ? { readOnly: true, sharedBy: obj.sharedBy || "" } : {}),
          kind: obj.kind || "backup",
          data: p.data,
        }));
      if (!list.length) throw new Error("No projects found in that file.");
      return list;
    },

    // Adds projects as new entries; returns the id of the last one added
    addImported(list) {
      let lastId = null;
      const added = [];
      list.forEach(p => {
        const id = newId();
        added.push(id);
        state.projects[id] = {
          name: uniqueName(p.name),
          description: p.description || "",
          created: Date.now(),
          updated: Date.now(),
          data: p.data,
        };
        if (p.archived) state.projects[id].archived = true;
        if (p.readOnly) { state.projects[id].readOnly = true; state.projects[id].sharedBy = p.sharedBy || ""; }
        // Keep the share id unless this browser already has a copy with it
        // (a read-only copy always keeps it, so comments sent back find the original)
        if (p.shareId && (p.readOnly || !Object.values(state.projects).some(x => x.shareId === p.shareId))) state.projects[id].shareId = p.shareId;
        lastId = id;
      });
      saveState(added);
      return lastId;
    },

    // Imports everything in a backup and switches to the last project added
    restore(obj) {
      const list = this.parseBackup(obj);
      this.switchTo(this.addImported(list));   // (un-archives the one it opens)
      return list.length;
    },
  };


  /* ---------- Make the API available to every other script ---------- */
  window.Projects = Projects;
})();
