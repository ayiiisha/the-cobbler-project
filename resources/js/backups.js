/* =========================================================
   backups.js — automatic backups, and a nudge when there are none
   ---------------------------------------------------------
   Everything lives in this browser, so losing the browser's data
   means losing the work. This file keeps a copy outside it:

   1. Automatic backups to a folder you choose (Settings › Backups):
      all projects, as a backup file, in <folder>/Cobbler backups/
      all-projects-backup-<date>-<time>.json, once a day or once a
      week, keeping the newest few. Written when a page opens and
      the last one is old enough, and now and then while the app
      stays open. Needs the File System Access API (Chrome, Edge).
      The folder's handle is kept in FileStore ("backup-folder-handle").
   2. A reminder when there's real work and no backup for a week
      (or ever): a note on the page, once a day, with "Back up now"
      (downloads all projects) and "Set up automatic backups".
   3. Asks the browser, once, to keep this site's data when the
      disk runs low (navigator.storage.persist), once there's work
      worth keeping. Settings › Storage shows whether it agreed.

   Settings live in localStorage under "cobblerBackups":
     { auto, every: "day" | "week", keep, lastAuto, folder, nagAt }
   The time of the last backup of any kind is Projects.lastBackup().

   Needs projects-core.js and file-store.js (and sync.js for notes).
   ========================================================= */
(() => {

  if (!window.Projects || !window.FileStore) return;

  const { el, $, formatDate } = Cobbler;
  const KEY = "cobblerBackups";
  const HANDLE_KEY = "backup-folder-handle";
  const FOLDER_NAME = "Cobbler backups";
  const DAY = 24 * 60 * 60 * 1000;
  const REMIND_AFTER = 7 * DAY;
  const supported = typeof window.showDirectoryPicker === "function";

  const load = () => { try { return { auto: false, every: "day", keep: 14, lastAuto: 0, folder: "", nagAt: 0, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { auto: false, every: "day", keep: 14, lastAuto: 0, folder: "", nagAt: 0 }; } };
  let settings = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

  const status = { state: supported ? (settings.auto ? "on" : "off") : "unsupported", message: "" };
  const announce = () => { document.dispatchEvent(new Event("backups-changed")); renderPanel(); };
  const toast = (message, actions, id) => window.CobblerSync?.toast?.(message, actions, { id });


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
    if (!supported) throw new Error("This browser can't write to folders. Use Chrome or Edge on a computer, or back up with the download button.");
    const handle = await window.showDirectoryPicker({ id: "cobbler-backups", mode: "readwrite" });
    await FileStore.put(HANDLE_KEY, handle);
    settings.auto = true;
    settings.folder = handle.name;
    save();
    status.state = "on";
    status.message = "";
    announce();
    await backupNow({ ask: true });   // the first one, right away
    return handle.name;
  }

  async function stop() {
    settings.auto = false;
    save();
    status.state = supported ? "off" : "unsupported";
    status.message = "";
    announce();
  }

  async function forgetFolder() {
    await FileStore.remove(HANDLE_KEY).catch(() => {});
    settings.folder = "";
    await stop();
  }


  /* =========================================================
     WRITING A BACKUP
     ========================================================= */

  const stamp = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const isBackupFile = (name) => /^all-projects-backup-.*\.json$/.test(name);

  /* Writes a backup file into the folder and prunes old ones. Returns the file name, or null. */
  async function backupNow({ ask = false } = {}) {
    const handle = await getHandle();
    if (!handle) { status.message = "No backup folder chosen yet."; announce(); return null; }
    if (!(await allowed(handle, ask))) {
      status.state = "blocked";
      status.message = "The browser needs permission to write to the backup folder again.";
      announce();
      return null;
    }
    try {
      await Projects.flushed?.();
      const dir = await handle.getDirectoryHandle(FOLDER_NAME, { create: true });
      const name = `all-projects-backup-${stamp()}.json`;
      const file = await dir.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write(JSON.stringify(Projects.backupData(), null, 2));
      await writable.close();
      // Keep the newest `keep` backups
      const names = [];
      for await (const [entry, h] of dir.entries()) if (h.kind === "file" && isBackupFile(entry)) names.push(entry);
      names.sort();
      for (const old of names.slice(0, Math.max(0, names.length - Math.max(1, Number(settings.keep) || 14)))) {
        await dir.removeEntry(old).catch(() => {});
      }
      settings.lastAuto = Date.now();
      settings.folder = handle.name;
      save();
      Projects.noteBackup();
      status.state = "on";
      status.message = "";
      announce();
      return name;
    } catch (err) {
      status.state = "error";
      status.message = `Couldn't write the backup: ${err.message}`;
      announce();
      return null;
    }
  }

  const interval = () => settings.every === "week" ? 7 * DAY : DAY;
  const due = () => settings.auto && Date.now() - (settings.lastAuto || 0) >= interval();

  /* On every page: back up when one is due. Permission can only be asked for on a click,
     so when it's missing a note offers the click. */
  async function tick() {
    if (!settings.auto || !supported || !due()) return;
    const handle = await getHandle();
    if (!handle) return;
    if (await allowed(handle)) { await backupNow(); return; }
    status.state = "blocked";
    status.message = "The browser needs permission to write to the backup folder again.";
    announce();
    toast("Automatic backup is due, and the browser needs your permission for the backup folder again.", [["Allow and back up", () => backupNow({ ask: true })]], "backup-toast");
  }


  /* =========================================================
     THE REMINDER (when backups aren't automatic)
     ========================================================= */

  function remind() {
    if (settings.auto) return;
    if (!Projects.hasContent()) return;
    const last = Projects.lastBackup();
    if (last && Date.now() - last < REMIND_AFTER) return;
    if (Date.now() - (settings.nagAt || 0) < DAY) return;   // once a day at most
    settings.nagAt = Date.now();
    save();
    const since = last ? `in ${Math.floor((Date.now() - last) / DAY)} days` : "yet";
    toast(`Your projects live only in this browser, and haven't been backed up ${since}.`, [
      ["Back up now", () => Projects.backupAll()],
      ...(supported && !location.pathname.endsWith("settings.html") ? [["Set up automatic backups", () => { location.href = "settings.html#backups"; }]] : []),
    ], "backup-toast");
  }


  /* =========================================================
     KEEPING THE DATA (navigator.storage.persist)
     ========================================================= */

  async function keepSafe() {
    if (!navigator.storage?.persist || !navigator.storage.persisted) return;
    try {
      if (await navigator.storage.persisted()) return;
      if (!Projects.hasContent()) return;
      const asked = Number(localStorage.getItem("cobblerPersistAskedAt")) || 0;
      if (Date.now() - asked < 7 * DAY) return;   // the browser said no: ask again in a week
      localStorage.setItem("cobblerPersistAskedAt", String(Date.now()));
      await navigator.storage.persist();
    } catch {}
  }


  /* =========================================================
     SETTINGS › BACKUPS (only on the Settings page)
     ========================================================= */

  function renderPanel() {
    const box = $("backups-panel");
    if (!box) return;
    const last = Projects.lastBackup();
    const when = (ms) => ms ? `${formatDate(ms, { weekday: true })} ${new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "never";
    const lines = [
      el("p", {}, el("strong", {}, "Last backup: "), when(last), last && Date.now() - last > REMIND_AFTER ? " (over a week ago)" : ""),
    ];
    if (!supported) {
      lines.push(el("p", { class: "media-muted" }, "This browser can't write to a folder on its own (that needs Chrome or Edge on a computer). Use “Back up all projects” regularly instead; a note reminds you after a week."));
    } else if (settings.auto) {
      lines.push(
        el("p", {}, el("strong", {}, "Automatic backups: on. "), `Every ${settings.every === "week" ? "week" : "day"} into “${settings.folder || "the chosen folder"}/${FOLDER_NAME}”, keeping the newest ${settings.keep}.`,
          settings.lastAuto ? ` Last written ${when(settings.lastAuto)}.` : ""),
        status.message && el("p", { class: "help-status", role: "status" }, status.message),
        el("div", { class: "help-downloads" },
          el("label", { class: "tool-group" }, "How often ",
            el("select", { class: "team-select", "aria-label": "How often to back up", onchange: (e) => { settings.every = e.target.value; save(); renderPanel(); } },
              el("option", { value: "day", selected: settings.every !== "week" }, "Every day"),
              el("option", { value: "week", selected: settings.every === "week" }, "Every week"))),
          el("label", { class: "tool-group" }, "Keep ",
            el("select", { class: "team-select", "aria-label": "How many backups to keep", onchange: (e) => { settings.keep = Number(e.target.value); save(); renderPanel(); } },
              [7, 14, 30, 90].map(n => el("option", { value: String(n), selected: settings.keep === n }, `${n} newest`)))),
          el("button", { type: "button", class: "small-btn", onclick: async () => { const name = await backupNow({ ask: true }); setStatus(name ? `Written ${name}.` : status.message); } }, "Back up now"),
          el("button", { type: "button", class: "small-btn", onclick: () => chooseFolder().then(n => setStatus(`Backing up to “${n}”.`)).catch(err => { if (err.name !== "AbortError") setStatus(err.message); }) }, "Change folder…"),
          el("button", { type: "button", class: "small-btn", onclick: () => forgetFolder().then(() => setStatus("Automatic backups are off.")) }, "Stop automatic backups")));
    } else {
      lines.push(
        el("p", {}, "Choose a folder (a synced one such as Google Drive, Dropbox or iCloud Drive is ideal) and the app writes a backup of every project into it every day or week, keeping the newest few. The folder is only written to; nothing else is read from it."),
        el("div", { class: "help-downloads" },
          el("button", { type: "button", class: "small-btn", onclick: () => chooseFolder().then(n => setStatus(`Backing up to “${n}”. The first backup has been written.`)).catch(err => { if (err.name !== "AbortError") setStatus(err.message); }) }, "Back up automatically to a folder…")));
    }
    box.replaceChildren(...lines.filter(Boolean));
  }

  let statusTimer = 0;
  function setStatus(message) {
    const node = $("backups-status");
    if (!node) return;
    node.textContent = message || "";
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(() => { node.textContent = ""; }, 8000);
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    renderPanel();
    if (location.hash === "#backups") $("backups")?.scrollIntoView();
    // Not in the way of the page's own start-up
    setTimeout(async () => {
      await tick();
      remind();
      keepSafe();
    }, 2500);
    // While the app stays open: a check every half hour
    setInterval(tick, 30 * 60 * 1000);
    document.addEventListener("projects-refresh", renderPanel);
  });

  window.CobblerBackups = { chooseFolder, backupNow, stop, forgetFolder, settings: () => ({ ...settings }), status };
})();
