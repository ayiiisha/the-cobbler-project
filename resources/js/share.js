/* =========================================================
   share.js — share a project with collaborators, and merge
   ---------------------------------------------------------
   Sharing makes a file (.json) with everything in a project,
   including uploaded files (images, drawings, PDFs) that a
   normal backup leaves out. Your friend imports it on the
   Projects page; when they send theirs back, you merge it into
   your copy instead of adding a second project.

   Every copy of a shared project keeps the same share id, so
   the Projects page knows which project a shared file belongs to.

   Merging (ProjectShare.merge(mine, theirs)):
     • Lists of things with ids (research notes, comments and
       their replies, interviews, edits, tasks…) are combined:
       everything from both sides, matched by id.
     • The same thing changed on both sides is merged field by
       field. Where both changed the same field differently, it's
       a "difference": the newer side wins when the thing records
       when it was changed (updated / edited), otherwise yours
       does (or theirs, if yours is empty). Each difference can
       be switched before merging.
     • Lists of plain words (tags) are combined.
     • This browser remembers the last version sent or received
       (the "base"). Compared with it, a change made on only one
       side is taken without asking, and things the other person
       deleted are removed. Without a base (the very first merge),
       anything deleted on one side comes back from the other.

   Needs projects-core.js and file-store.js.
   ========================================================= */
(() => {

  if (!window.Projects) return;

  const KEY_NAMES = Projects.KEY_NAMES;
  const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
  const shorten = (t, n = 40) => { const s = String(t).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* Merging lives in projects-core.js (Projects.mergeData), shared with saving and folder sync.
     merge(mine, theirs, base) → { data, conflicts, added, removed } */
  const merge = (mine, theirs, base) => Projects.mergeData(mine, theirs, base);

  // A short, readable version of a value for the difference list
  function preview(value) {
    if (value == null || value === "") return "(empty)";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "number" && value > 1e12) return new Date(value).toLocaleString();
    if (Array.isArray(value)) return value.length ? shorten(value.map(v => typeof v === "object" ? Projects.itemLabel(v) : v).join(", "), 80) : "(none)";
    if (typeof value === "object") return shorten(JSON.stringify(value), 80);
    return shorten(value, 120);
  }

  /* =========================================================
     THE LAST SHARED VERSION
     Kept in this browser's file storage (not in the project, to
     save space): what was last sent or received for each shared
     project. It's the "base" for the next merge.
     ========================================================= */

  const baseKey = (shareId) => `share-base:${shareId}`;
  async function saveBase(shareId, data) {
    if (!shareId || !window.FileStore) return;
    try { await FileStore.put(baseKey(shareId), new Blob([JSON.stringify(data)], { type: "application/json" })); } catch {}
  }
  async function loadBase(shareId) {
    if (!shareId || !window.FileStore) return undefined;
    try {
      const blob = await FileStore.get(baseKey(shareId));
      return blob ? JSON.parse(await blob.text()) : undefined;
    } catch { return undefined; }
  }

  /* =========================================================
     FILES (images, drawings, PDFs kept in the browser)
     ========================================================= */

  // Every text value in the data (file ids are stored as text)
  function strings(value, out = new Set()) {
    if (typeof value === "string") out.add(value);
    else if (Array.isArray(value)) value.forEach(v => strings(v, out));
    else if (isObject(value)) Object.values(value).forEach(v => strings(v, out));
    return out;
  }

  const toDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  async function filesFor(data) {
    if (!window.FileStore?.keys) return {};
    let keys = [];
    try { keys = await FileStore.keys(); } catch { return {}; }
    const used = strings(data);
    const files = {};
    for (const id of keys.filter(k => used.has(String(k)))) {
      const blob = await FileStore.get(id).catch(() => null);
      if (blob) files[id] = { type: blob.type || "application/octet-stream", name: blob.name || "", data: await toDataUrl(blob) };
    }
    return files;
  }

  /* Saves files from a shared file that this browser doesn't have yet. Returns how many. */
  async function storeFiles(files) {
    if (!files || !window.FileStore) return 0;
    let have = [];
    try { have = await FileStore.keys(); } catch {}
    let n = 0;
    for (const [id, f] of Object.entries(files)) {
      if (have.includes(id) || typeof f?.data !== "string") continue;
      try {
        const blob = await (await fetch(f.data)).blob();
        await FileStore.put(id, f.name ? new File([blob], f.name, { type: f.type }) : blob);
        n++;
      } catch {}
    }
    return n;
  }


  /* =========================================================
     THE SHARE FILE
     ========================================================= */

  const slugOf = (text) => Cobbler.slug(text, "project");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  /* Builds the file to share: { file (a File), name, bytes, files (how many uploads) } */
  /* readOnly: a copy for feedback (they can only comment).
     feedback: just your comments on a read-only copy, to send back. */
  async function buildShareFile(id, { readOnly = false, feedback = false } = {}) {
    const info = Projects.info().find(p => p.id === id);
    if (!info) return null;
    const shareId = Projects.shareIdOf(id, { create: !feedback });
    const all = Projects.snapshot(id);
    const data = feedback ? { comments: all.comments || {} } : all;
    const files = feedback ? {} : await filesFor(data);
    if (!readOnly && !feedback) await saveBase(shareId, data);
    const sharedBy = Projects.me();
    const obj = {
      app: "cobbler-project", version: 1, kind: feedback ? "feedback" : "share", shared: Date.now(), sharedBy,
      ...(readOnly ? { readOnly: true } : {}),
      projects: [{ name: info.name, description: info.description, shareId, data }],
      files,
    };
    const who = sharedBy ? `-from-${slugOf(sharedBy)}` : "";
    const name = `${slugOf(info.name)}-${feedback ? "feedback" : readOnly ? "read-only" : "shared"}${who}-${today()}.json`;
    const file = new File([JSON.stringify(obj)], name, { type: "application/json" });
    return { file, name, bytes: file.size, files: Object.keys(files).length, info };
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function download(id, options = {}) {
    const built = await buildShareFile(id, options);
    if (!built) return null;
    save(built.file, built.name);
    if (!options.readOnly && !options.feedback) Projects.markShared(id);
    return { files: built.files, bytes: built.bytes, name: built.name };
  }


  /* =========================================================
     WHAT CHANGED SINCE YOU LAST SHARED
     From the activity feed: everything since the last share,
     grouped by page.
     ========================================================= */

  function changesSince(id, since = Projects.lastShared(id)) {
    const entries = Projects.activity(id, { since }).sort((a, b) => a.at - b.at);
    // The net change per thing: added then deleted = nothing; added then edited = added
    const net = new Map();
    entries.forEach(e => {
      const k = `${e.key}|${e.label}`;
      const prev = net.get(k);
      if (!prev) { net.set(k, { ...e, first: e.kind, people: new Set([e.by]) }); return; }
      prev.people.add(e.by);
      prev.at = e.at;
      prev.kind = prev.first === "added" ? (e.kind === "deleted" ? "gone" : "added") : e.kind;
    });
    const byKey = new Map();
    [...net.values()].filter(e => e.kind !== "gone").forEach(e => {
      const page = KEY_NAMES[e.key] || e.key;
      if (!byKey.has(page)) byKey.set(page, []);
      const what = e.label.startsWith(page) ? e.label.slice(page.length).trim() : e.label;
      const verb = e.kind === "added" ? "Added" : e.kind === "deleted" ? "Deleted" : "Changed";
      const others = [...e.people].filter(p => p && p !== Projects.me());
      byKey.get(page).push(`${verb} ${what || page}` + (others.length ? ` (${others.join(", ")})` : ""));
    });
    return { since, count: entries.length, groups: [...byKey.entries()].map(([page, lines]) => ({ page, lines })) };
  }

  function changesText(id) {
    const info = Projects.info().find(p => p.id === id);
    const { since, groups } = changesSince(id);
    const when = since ? new Date(since).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "the start";
    if (!groups.length) return `No changes to “${info?.name}” since ${since ? `you last shared it (${when})` : "it was made"}.`;
    return [`Changes to “${info?.name}” since ${since ? `I last shared it (${when})` : "the start"}:`, "",
      ...groups.flatMap(g => [`${g.page}`, ...g.lines.map(l => `  • ${l}`), ""])].join("\n").trim();
  }


  /* =========================================================
     EMAIL
     Uses the computer's share sheet with the file attached where
     the browser can (Safari, Chrome on Mac/Windows/phones);
     otherwise downloads the file and opens a new email to attach it to.
     ========================================================= */

  async function email(id) {
    const built = await buildShareFile(id);
    if (!built) return null;
    const team = Projects.getDataFor(id, "team", []);
    const to = (Array.isArray(team) ? team : []).map(m => m.email).filter(e => e && /@/.test(e) && e !== localEmail(team));
    const subject = `Cobbler project: ${built.info.name}`;
    const report = changesText(id);
    const howTo = "To open it: go to the Projects page of The Cobbler Project and import this file (or drop it on the import box). If you already have this project, choose Merge.";
    const body = `${report}\n\n${howTo}`;

    if (navigator.canShare?.({ files: [built.file] })) {
      try {
        await navigator.share({ files: [built.file], title: subject, text: body });
        Projects.markShared(id);
        return { how: "share", ...built };
      } catch (err) {
        if (err?.name === "AbortError") return { how: "cancelled" };
      }
    }
    save(built.file, built.name);
    const short = body.length > 1500 ? body.slice(0, 1500) + "…" : body;
    location.href = `mailto:${to.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${short}\n\n(Attach the file ${built.name} from your Downloads folder.)`)}`;
    Projects.markShared(id);
    return { how: "mailto", ...built };
  }
  // Your own address, if you're on the team (by name), so you don't email yourself
  function localEmail(team) {
    const name = Projects.me().toLowerCase();
    return (Array.isArray(team) ? team : []).find(m => name && (m.name || "").toLowerCase() === name)?.email || "";
  }


  /* =========================================================
     UNDO A MERGE
     A copy of the project from just before each merge, kept in
     file storage: undo-merge:<project id> = { at, label, data }
     ========================================================= */

  async function saveUndo(id, label) {
    if (!window.FileStore) return;
    const data = Projects.snapshot(id);
    try { await FileStore.put(`undo-merge:${id}`, new Blob([JSON.stringify({ at: Date.now(), label, data })], { type: "application/json" })); } catch {}
  }
  async function undoInfo(id) {
    if (!window.FileStore) return null;
    try {
      const blob = await FileStore.get(`undo-merge:${id}`);
      return blob ? JSON.parse(await blob.text()) : null;
    } catch { return null; }
  }
  async function undoMerge(id) {
    const saved = await undoInfo(id);
    if (!saved) return false;
    Projects.replaceData(id, saved.data);
    await FileStore.remove(`undo-merge:${id}`).catch(() => {});
    return true;
  }

  /* =========================================================
     WHO'S WORKING ON WHAT
     A "Claim" button for anything with an id (an edit, a package,
     a draft, a song): tells collaborators you're working on it, so
     two people don't rework the same thing. Advisory only.
     project.data.claims = [{ id: <the thing's id>, by, at, label, page }]
     ========================================================= */

  function claimButton(itemId, label) {
    const box = document.createElement("span");
    box.className = "claim";
    const draw = () => {
      const claims = Projects.getData("claims", []);
      const list = Array.isArray(claims) ? claims : [];
      const claim = list.find(c => c.id === itemId);
      const mine = claim && claim.by === (Projects.me() || "Someone");
      const days = claim ? (Date.now() - claim.at) / 86400000 : 0;
      const ago = !claim ? "" : days < 1 / 24 ? "just now" : days < 1 ? `${Math.round(days * 24)} h ago` : `${Math.round(days)} days ago`;
      const save = (next) => { Projects.setData("claims", next); draw(); };
      const button = (text, fn, title) => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "comment-action"; b.textContent = text;
        if (title) b.title = title;
        b.addEventListener("click", fn);
        return b;
      };
      const take = () => save([...list.filter(c => c.id !== itemId),
        { id: itemId, by: Projects.me() || "Someone", at: Date.now(), label: String(label || ""), page: location.pathname.split("/").pop() }]);
      const note = document.createElement("span");
      note.className = "claim-note";
      box.classList.toggle("is-mine", !!mine);
      box.classList.toggle("is-theirs", !!claim && !mine);
      if (!claim) {
        box.replaceChildren(button("Claim", take, "Tell collaborators you're working on this"));
      } else if (mine) {
        note.textContent = "You're working on this · ";
        box.replaceChildren(note, button("Done", () => save(list.filter(c => c.id !== itemId))));
      } else {
        note.textContent = `${claim.by} ${days > 3 ? "was" : "is"} working on this (${ago}) · `;
        box.replaceChildren(note, button("Take over", () => { if (confirm(`Take this over from ${claim.by}?`)) take(); }));
      }
    };
    draw();
    return box;
  }

  /* =========================================================
     LOCKED VERSIONS
     A frozen copy of a project ("Picture lock", "Final draft")
     kept in this browser's file storage, where syncing and merging
     never touch it: lock:<project id>:<lock id> = { name, at, by, data }
     ========================================================= */

  async function lockVersion(id, name) {
    const lockId = "lk" + Date.now().toString(36);
    await FileStore.put(`lock:${id}:${lockId}`, new Blob([JSON.stringify({ name, at: Date.now(), by: Projects.me(), data: Projects.snapshot(id) })], { type: "application/json" }));
    return lockId;
  }
  async function lockedVersions(id) {
    if (!window.FileStore) return [];
    let keys = [];
    try { keys = (await FileStore.keys()).map(String).filter(k => k.startsWith(`lock:${id}:`)); } catch { return []; }
    const out = [];
    for (const key of keys) {
      try { const v = JSON.parse(await (await FileStore.get(key)).text()); out.push({ key, name: v.name, at: v.at, by: v.by, data: v.data }); } catch {}
    }
    return out.sort((a, b) => b.at - a.at);
  }
  const deleteLock = (key) => FileStore.remove(key);

  window.ProjectShare = {
    lockVersion, lockedVersions, deleteLock,
    claimButton,
    merge, preview, download, email, buildShareFile, changesSince, changesText,
    storeFiles, filesFor, strings, saveBase, loadBase, saveUndo, undoInfo, undoMerge, KEY_NAMES,
  };
})();
