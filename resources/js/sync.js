/* =========================================================
   sync.js — sync projects through a shared folder
   ---------------------------------------------------------
   Pick a folder that everyone you work with can reach, such as a
   shared Google Drive folder on your computer (through Google
   Drive for desktop), Dropbox, iCloud Drive or Syncthing. The
   app then keeps the projects you choose up to date through it:

     <chosen folder>/
       Rent Doc [s1a2b3c]/            one folder per project (its share id)
         people/
           aisha-k3f9.cobbler.json    each person writes only their own file
           sam-x81q.cobbler.json
         files/
           img…~image_png             uploaded images, drawings, PDFs

   Each person writes only their own file and reads everyone
   else's, merging them in (Projects.mergeData), so the sync
   service never has two people editing the same file. Project
   data never leaves your browser except into this folder: the
   website itself (e.g. GitHub Pages) only serves the app's code.

   Needs a browser that can open folders (Chrome or Edge on a
   computer). Elsewhere, Share and Import on the Projects page
   still work.

   Also here, on every page:
     • the sync status in the sidebar
     • the reminder to share projects you haven't shared lately
     • the note when a collaborator's changes arrive ("Show them"
       redraws the page in place), and the redraw when another
       tab of this browser saves
     • the storage warning, and the toast() other scripts use

   Needs projects-core.js, file-store.js and share.js.
   ========================================================= */
(() => {

  if (!window.Projects || !window.FileStore) return;

  const supported = typeof window.showDirectoryPicker === "function";
  const HANDLE_KEY = "sync-folder-handle";     // in FileStore (folder handles can be stored there)
  const EVERY = 30 * 1000;                     // check the folder this often while the page is open
  const ls = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };

  // This browser's short id, so two of your devices don't write the same file
  const device = (() => {
    let id = ls.get("cobblerDevice", "");
    if (!id) { id = Math.random().toString(36).slice(2, 6); ls.set("cobblerDevice", id); }
    return id;
  })();

  const slug = (text) => Cobbler.slug(text, "someone");
  const safeName = (text) => String(text).replace(/[\\/:*?"<>|[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Project";
  const myFile = () => `${slug(Projects.me())}-${device}.cobbler.json`;

  // A tiny hash, to tell whether data changed since we last wrote it
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + text.length.toString(36);
  }

  const status = { state: supported ? "off" : "unsupported", folder: "", last: 0, message: "", busy: false, joinable: [] };
  const listeners = new Set();
  const announce = () => { listeners.forEach(fn => { try { fn(status); } catch {} }); renderPill(); };


  /* =========================================================
     THE FOLDER
     ========================================================= */

  async function getHandle() {
    try { return await FileStore.get(HANDLE_KEY) || null; } catch { return null; }
  }

  async function allowed(handle, ask = false) {
    const opts = { mode: "readwrite" };
    try {
      if (await handle.queryPermission(opts) === "granted") return true;
      return ask ? await handle.requestPermission(opts) === "granted" : false;
    } catch { return false; }
  }

  async function chooseFolder() {
    if (!supported) throw new Error("This browser can't open folders. Use Chrome or Edge on a computer, or Share and Import instead.");
    const handle = await window.showDirectoryPicker({ id: "cobbler-sync", mode: "readwrite" });
    await FileStore.put(HANDLE_KEY, handle);
    status.folder = handle.name;
    await start({ ask: true });
    return handle.name;
  }

  async function forgetFolder() {
    await FileStore.remove(HANDLE_KEY).catch(() => {});
    clearInterval(timer);
    Object.assign(status, { state: "off", folder: "", message: "", joinable: [] });
    announce();
  }

  // The project's folder: "<name> [<share id>]" (found by its share id, even if renamed)
  async function projectDir(root, shareId, name, create) {
    for await (const [entry, handle] of root.entries()) {
      if (handle.kind === "directory" && entry.endsWith(`[${shareId}]`)) return handle;
    }
    return create ? root.getDirectoryHandle(`${safeName(name)} [${shareId}]`, { create: true }) : null;
  }

  async function readJSON(handle) {
    const file = await handle.getFile();
    return { file, data: JSON.parse(await file.text()) };
  }

  async function writeText(dir, name, text) {
    const handle = await dir.getFileHandle(name, { create: true });
    const stream = await handle.createWritable();
    await stream.write(text);
    await stream.close();
  }


  /* =========================================================
     SYNCING ONE PROJECT
     ========================================================= */

  const peerBaseKey = (shareId, person) => `sync-base:${shareId}:${person}`;
  async function peerBase(shareId, person) {
    try { const b = await FileStore.get(peerBaseKey(shareId, person)); return b ? JSON.parse(await b.text()) : undefined; } catch { return undefined; }
  }
  const savePeerBase = (shareId, person, data) =>
    FileStore.put(peerBaseKey(shareId, person), new Blob([JSON.stringify(data)], { type: "application/json" })).catch(() => {});

  async function syncProject(root, id, report) {
    const info = Projects.info().find(p => p.id === id);
    if (!info) return;
    const shareId = Projects.shareIdOf(id, { create: true });
    const dir = await projectDir(root, shareId, info.name, true);
    const people = await dir.getDirectoryHandle("people", { create: true });
    const filesDir = await dir.getDirectoryHandle("files", { create: true });
    const seen = ls.get("cobblerSyncSeen", {});

    // 1. Everyone else's changes
    for await (const [name, handle] of people.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".cobbler.json") || name === myFile()) continue;
      const file = await handle.getFile();
      const seenKey = `${shareId}/${name}`;
      if (seen[seenKey] === file.lastModified) continue;
      let theirs;
      try { theirs = JSON.parse(await file.text()); } catch { continue; }   // still arriving: try again next time
      if (theirs?.shareId !== shareId || !theirs.data) { seen[seenKey] = file.lastModified; continue; }

      const mine = Projects.snapshot(id);
      const result = Projects.mergeData(mine, theirs.data, await peerBase(shareId, name));
      if (JSON.stringify(result.data) !== JSON.stringify(mine)) {
        await ProjectShare.saveUndo(id, `before ${theirs.person || "a collaborator"}'s changes`);
        Projects.replaceData(id, result.data);
        report.merged.push({ id, project: info.name, person: theirs.person || "Someone", differences: result.conflicts.length });
        recordConflicts(id, theirs.person || "Someone", result.conflicts);
      }
      await savePeerBase(shareId, name, theirs.data);
      seen[seenKey] = file.lastModified;
    }
    ls.set("cobblerSyncSeen", seen);

    // 2. Uploaded files: send ours, fetch any we're missing
    const data = Projects.snapshot(id);
    const used = ProjectShare.strings(data);
    const inFolder = new Map();
    for await (const [name, handle] of filesDir.entries()) if (handle.kind === "file") inFolder.set(name.split("~")[0], { name, handle });
    let local = [];
    try { local = (await FileStore.keys()).map(String); } catch {}
    for (const fileId of local.filter(k => used.has(k) && !inFolder.has(k))) {
      const blob = await FileStore.get(fileId).catch(() => null);
      if (!blob) continue;
      const handle = await filesDir.getFileHandle(`${fileId}~${(blob.type || "application/octet-stream").replace("/", "_")}`, { create: true });
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      report.filesUp++;
    }
    for (const [fileId, { name, handle }] of inFolder) {
      if (!used.has(fileId) || local.includes(fileId)) continue;
      const file = await handle.getFile();
      const type = (name.split("~")[1] || "").replace("_", "/");
      await FileStore.put(fileId, new File([file], file.name, { type: type || file.type }));
      report.filesDown++;
    }

    // 3. Our own file, if anything changed since we last wrote it
    const wrote = ls.get("cobblerSyncWrote", {});
    const text = JSON.stringify(data);
    const h = hash(text);
    if (wrote[shareId] !== h || !(await people.getFileHandle(myFile()).then(() => true, () => false))) {
      await writeText(people, myFile(), JSON.stringify({
        app: "cobbler-project", kind: "sync", version: 1, shareId,
        name: info.name, description: info.description, person: Projects.me() || "Someone", device, saved: Date.now(), data,
      }));
      wrote[shareId] = h;
      ls.set("cobblerSyncWrote", wrote);
      report.written++;
    }
    Projects.markShared(id);
  }

  /* =========================================================
     DIFFERENCES SETTLED AUTOMATICALLY (the conflict inbox)
     When you and someone else both changed the same thing, sync
     keeps the newer change. Each one is listed on the Projects
     page, where you can switch to the other version.
       localStorage cobblerConflicts:<project id> = [{ id, at, person, where, field, path, mine, theirs, chose }]
     ========================================================= */

  const conflictKey = (id) => `cobblerConflicts:${id}`;
  function recordConflicts(id, person, conflicts) {
    const real = conflicts.filter(c => c.path?.length && c.mine !== "" && c.mine != null && c.theirs !== "" && c.theirs != null);
    if (!real.length) return;
    const list = ls.get(conflictKey(id), []);
    real.forEach(c => list.push({ id: "cf" + Math.random().toString(36).slice(2, 9), at: Date.now(), person, where: c.where, field: c.field,
      path: c.path, mine: c.mine, theirs: c.theirs, chose: c.choice }));
    ls.set(conflictKey(id), list.slice(-100));
  }
  const conflictsFor = (id) => ls.get(conflictKey(id), []);
  function dismissConflict(id, conflictId) {
    ls.set(conflictKey(id), conflictsFor(id).filter(c => c.id !== conflictId));
  }
  // Switches to the version that wasn't kept (saved like any edit, so it syncs)
  function switchConflict(id, conflictId) {
    const c = conflictsFor(id).find(x => x.id === conflictId);
    if (!c) return false;
    const key = c.path[0];
    const root = { [key]: JSON.parse(JSON.stringify(Projects.getDataFor(id, key, null))) };
    const value = c.chose === "mine" ? c.theirs : c.mine;
    if (!Projects.setAtPath(root, c.path, value)) return false;
    Projects.setDataFor(id, key, root[key]);
    dismissConflict(id, conflictId);
    return true;
  }

  /* Projects in the folder that this browser doesn't have yet */
  async function findJoinable(root) {
    const have = new Set(Projects.info().map(p => p.shareId).filter(Boolean));
    const out = [];
    for await (const [entry, handle] of root.entries()) {
      const m = handle.kind === "directory" && entry.match(/\[(s[a-z0-9]+)\]$/);
      if (!m || have.has(m[1])) continue;
      let newest = null;
      try {
        const people = await handle.getDirectoryHandle("people");
        for await (const [name, h] of people.entries()) {
          if (h.kind !== "file" || !name.endsWith(".cobbler.json")) continue;
          const file = await h.getFile();
          if (!newest || file.lastModified > newest.file.lastModified) newest = { file, handle: h };
        }
      } catch { continue; }
      if (newest) {
        try {
          const obj = JSON.parse(await newest.file.text());
          out.push({ shareId: m[1], folder: entry, name: obj.name || entry, person: obj.person || "", saved: obj.saved || newest.file.lastModified, handle: newest.handle });
        } catch {}
      }
    }
    return out;
  }

  async function join(shareId) {
    const found = status.joinable.find(j => j.shareId === shareId);
    if (!found) return null;
    const { data: obj } = await readJSON(found.handle);
    const id = Projects.addFromShare({ name: obj.name, description: obj.description, shareId, data: obj.data });
    await savePeerBase(shareId, found.handle.name, obj.data);
    document.dispatchEvent(new Event("projects-changed"));
    await syncNow();
    return id;
  }


  /* =========================================================
     RUNNING
     ========================================================= */

  let timer = 0;
  let root = null;

  async function syncNow() {
    if (!root || status.busy) return status;
    if (!(await allowed(root))) { status.state = "needs-permission"; announce(); return status; }
    status.busy = true;
    status.state = "syncing";
    announce();
    const report = { merged: [], filesUp: 0, filesDown: 0, written: 0 };
    try {
      if (!Projects.me()) throw new Error("Add your name first (Projects page › Sync folder), so others know whose changes are whose.");
      for (const p of Projects.info().filter(x => x.sync)) await syncProject(root, p.id, report);
      status.joinable = await findJoinable(root);
      Object.assign(status, { state: "ok", last: Date.now(), message: "" });
    } catch (err) {
      Object.assign(status, { state: "error", message: err?.message || String(err) });
    }
    status.busy = false;
    status.report = report;
    announce();
    if (report.merged.some(m => m.id === Projects.activeId())) offerReload(report.merged.filter(m => m.id === Projects.activeId()));
    return status;
  }

  async function start({ ask = false } = {}) {
    if (!supported) return;
    root = await getHandle();
    if (!root) { status.state = "off"; announce(); return; }
    status.folder = root.name;
    if (!(await allowed(root, ask))) { status.state = "needs-permission"; announce(); return; }
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) syncNow(); }, EVERY);
    await syncNow();
  }

  // Sync soon after your own saves, and when you come back to the page
  let soon = 0;
  document.addEventListener("projects-saved", () => {
    if (status.state !== "ok" && status.state !== "syncing") return;
    clearTimeout(soon);
    soon = setTimeout(syncNow, 4000);
  });
  window.addEventListener("focus", () => { if (status.state === "ok") syncNow(); });


  /* =========================================================
     ON EVERY PAGE: status in the sidebar, "changes arrived", reminders
     ========================================================= */

  const el = Cobbler.el;

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} days ago`;
  };

  function renderPill() {
    const nav = document.querySelector(".main-header .nav-links");
    if (!nav) return;
    let pill = document.getElementById("sync-pill");
    if (status.state === "off" || status.state === "unsupported") { pill?.remove(); return; }
    if (!pill) {
      pill = el("button", { type: "button", class: "sync-pill", id: "sync-pill" });
      pill.addEventListener("click", async () => {
        if (status.state === "needs-permission") { await start({ ask: true }); return; }
        location.href = "projects.html#sync";
      });
      nav.before(pill);
    }
    const text = {
      "needs-permission": "Sync paused: click to reconnect the folder",
      syncing: "Syncing…",
      ok: `Synced ${ago(status.last)}`,
      error: "Sync problem: see Projects",
    }[status.state] || "";
    pill.textContent = text;
    pill.title = status.message || `Sync folder: ${status.folder}`;
    pill.className = `sync-pill is-${status.state}`;
  }
  setInterval(() => { if (status.state === "ok") renderPill(); }, 60 * 1000);

  /* Changes arrived for the project you're looking at: show them when it's safe.
     The page redraws itself from the stored data (Projects.refresh); a page
     that can't reloads instead. */
  const busy = () => document.querySelector("dialog[open]") || document.activeElement?.matches("input, textarea, select, [contenteditable]");

  /* Another tab saved: the data has already been swapped in (projects-core.js); pages that can redraw themselves do,
     unless you're in the middle of typing (then the next thing you do shows them) */
  document.addEventListener("projects-data-changed", () => { if (!busy()) Projects.refresh({ reason: "tab" }); });

  function offerReload(merged) {
    const who = [...new Set(merged.map(m => m.person))].join(" and ");
    const show = () => { if (!Projects.refresh({ reason: "sync" })) location.reload(); };
    if (document.hidden) {
      document.addEventListener("visibilitychange", function once() {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", once);
        if (!busy()) show(); else toast(`${who}'s changes arrived.`, [["Show them", show]]);
      });
      return;
    }
    toast(`${who}'s changes arrived. Your own changes are kept.`, [["Show them", show]]);
  }

  function toast(message, actions = [], { id = "sync-toast" } = {}) {
    document.getElementById(id)?.remove();
    const box = el("div", { class: "sync-toast", id, role: "status" },
      el("p", {}, message),
      el("div", { class: "sync-toast-actions" },
        actions.map(([label, fn]) => el("button", { type: "button", class: "small-btn", onclick: () => { box.remove(); fn(); } }, label)),
        el("button", { type: "button", class: "small-btn", onclick: () => box.remove() }, "Close")));
    document.body.append(box);
  }

  /* "You haven't shared X in N days": for projects you've shared before, that changed since, and don't sync */
  function remind() {
    const days = Number(ls.get("shareReminderDays", 5));
    if (!days) return;
    const snooze = ls.get("shareReminderSnooze", {});
    const due = Projects.info().filter(p => p.shareId && !p.sync && !p.archived && p.lastShared
      && p.updated > p.lastShared && Date.now() - p.lastShared > days * 86400000 && (snooze[p.id] || 0) < Date.now());
    const p = due.find(x => x.active) || due[0];
    if (!p) return;
    const n = Math.floor((Date.now() - p.lastShared) / 86400000);
    toast(`You haven't shared “${p.name}” in ${n} days, and it's changed since.`, [
      ["Email it", () => ProjectShare.email(p.id)],
      ["Download to share", () => ProjectShare.download(p.id)],
      ["Remind me tomorrow", () => { snooze[p.id] = Date.now() + 86400000; ls.set("shareReminderSnooze", snooze); }],
    ], { id: "share-reminder" });
  }

  /* A read-only copy: a note at the top, and a reminder when something can't be saved */
  function readOnlyNotice() {
    if (!Projects.isReadOnly?.()) return;
    const from = Projects.readOnlyFrom();
    const main = document.querySelector("main");
    if (!main || document.getElementById("readonly-banner")) return;
    main.prepend(el("div", { class: "readonly-banner", id: "readonly-banner", role: "note" },
      el("strong", {}, "Read-only copy"), from ? ` shared by ${from} for feedback.` : " shared for feedback.",
      " You can read everything and add comments (the speech bubble). Other changes aren't saved. ",
      el("button", { type: "button", class: "small-btn", onclick: () => ProjectShare.download(Projects.activeId(), { feedback: true })
        .then(r => r && toast(`Downloaded ${r.name}. Send it to ${from || "them"}: they import it on the Projects page.`, [])) }, "Send my comments back")));
  }
  let blockedShown = 0;
  document.addEventListener("projects-read-only", () => {
    if (Date.now() - blockedShown < 15000) return;
    blockedShown = Date.now();
    toast("This is a read-only copy: only comments are saved. Your other changes will disappear when you leave the page.", [], { id: "readonly-toast" });
  });

  /* Browser storage nearly full: say so, at most once a day. Projects in IndexedDB
     have no ceiling of their own, so the browser is asked how much the site may use. */
  async function storageWarning() {
    const info = Projects.storageInfo?.();
    if (!info) return;
    let { used, limit } = info;
    if (!limit) {
      try { const estimate = await navigator.storage?.estimate?.(); if (estimate?.quota) { used = estimate.usage || 0; limit = estimate.quota; } } catch {}
    }
    if (!limit || used / limit < 0.8) return;
    const last = ls.get("storageWarned", 0);
    if (Date.now() - last < 86400000) return;
    ls.set("storageWarned", Date.now());
    toast(`Browser storage is ${Math.round(used / limit * 100)}% full. Saving may fail soon.`, [
      ["See what's using it", () => { location.href = "settings.html#storage"; }],
    ], { id: "storage-warning" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    start();
    setTimeout(remind, 2500);
    setTimeout(storageWarning, 3500);
    readOnlyNotice();
  });

  window.CobblerSync = {
    supported, status: () => status, chooseFolder, forgetFolder, syncNow, start, join,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reminderDays: () => Number(ls.get("shareReminderDays", 5)),
    setReminderDays(n) { ls.set("shareReminderDays", Math.max(0, Number(n) || 0)); },
    toast, conflictsFor, dismissConflict, switchConflict,
  };
})();
