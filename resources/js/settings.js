/* =========================================================
   settings.js — the Settings page
   ---------------------------------------------------------
   Themes are handled by color-themes.js. This file makes the
   "Download the blank app (.zip)" button work:

   It finds every file the app is made of by following links,
   starting from the pages in the sidebar: each page's scripts,
   styles and images, then anything those files point to (the
   default resources, the logo…), plus the README, change log,
   scripts and guides. It fetches them and puts them in a ZIP
   (zip.js). No project data is included: that lives in the
   browser, not in files.

   Browsers only let a page read other files when the app is
   opened from a web server (see the code guide), so the button
   explains that if the app was opened by double-clicking.

   Needs zip.js.
   ========================================================= */
(() => {

  const $ = (id) => document.getElementById(id);

  // Always included (not linked from the pages)
  const EXTRAS = [
    "README.md", "change-log.md", "update-resources.sh", "make-docs.sh",
    "resources/docs/user-guide.html", "resources/docs/code-guide.html", "resources/docs/docs.css",
    "resources/docs/user-guide.pdf", "resources/docs/code-guide.pdf",
    "default-resources-cobbler-project.csv",
    "resources/vendor/abcjs/LICENSE.txt",
    "resources/vendor/lz-string/LICENSE.txt",
    "index.html", "manifest.webmanifest", "sw.js",
    "resources/assets/icon-192.png", "resources/assets/icon-512.png",
    "eslint.config.mjs", "package.json", "tests/run.mjs", ".github/workflows/tests.yml",
  ];
  const FILE_TYPES = /\.(html|js|mjs|css|svg|png|jpe?g|gif|webp|csv|pdf|md|sh|json|txt|webmanifest|yml)$/i;
  const TEXT_TYPES = /\.(html|js|mjs|css|svg|md|sh|json|txt|csv|webmanifest|yml)$/i;

  function setStatus(message) { $("app-zip-status").textContent = message; }

  async function collectFiles() {
    const root = new URL("../", location.href);          // the folder above pages/
    const pagesDir = new URL("pages/", root);
    const found = new Map();                              // path inside the app → bytes
    const tried = new Set();
    const queue = [];

    const pathOf = (url) => url.href.slice(root.href.length);
    const consider = (raw, base) => {
      let url;
      try { url = new URL(raw, base); } catch { return; }
      url.hash = ""; url.search = "";
      if (!url.href.startsWith(root.href)) return;        // other websites (e.g. Google Fonts)
      const path = pathOf(url);
      if (!path || !FILE_TYPES.test(path) || path.startsWith("_backup") || (path.startsWith(".") && !path.startsWith(".github/"))) return;
      if (tried.has(url.href)) return;
      tried.add(url.href);
      queue.push(url);
    };

    // Starting points: the sidebar's pages, this page, everything already on screen, and the extras
    document.querySelectorAll(".nav-links a, [src], link[href]").forEach(n => consider(n.getAttribute("href") || n.getAttribute("src"), location.href));
    consider(location.href, location.href);
    EXTRAS.forEach(path => consider(path, root));

    while (queue.length && found.size < 400) {
      const url = queue.shift();
      let response;
      try { response = await fetch(url, { cache: "no-store" }); } catch { continue; }
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const path = pathOf(url);
      found.set(path, bytes);
      setStatus(`Collecting files… ${found.size}`);

      // Follow anything this file points to (relative to it, or to the pages folder for page templates)
      if (TEXT_TYPES.test(path)) {
        const text = new TextDecoder().decode(bytes);
        const refs = text.matchAll(/["'(]((?:\.{1,2}\/)*[\w.-]+(?:\/[\w.-]+)*\.(?:html|js|css|svg|png|jpe?g|gif|webp|csv|pdf|md|webmanifest))["')]/gi);
        for (const [, ref] of refs) {
          if (/^(https?:|data:|\/\/)/i.test(ref)) continue;
          consider(ref, url);
          consider(ref, pagesDir);
        }
        // Scripts a page lists for boot.js (data-scripts="a.js b.js …") live in resources/js/
        for (const [, list] of text.matchAll(/data-scripts="([^"]+)"/g)) {
          list.split(/\s+/).filter(Boolean).forEach(name => consider(name, new URL("resources/js/", root)));
        }
      }
    }
    return found;
  }

  async function downloadApp() {
    if (location.protocol === "file:") {
      setStatus("To download the app, open it from a local web server first: browsers don't let a page read files straight from the disk. The code guide (“Running the app”) shows the one command to run.");
      return;
    }
    const button = $("app-zip");
    button.disabled = true;
    try {
      const files = await collectFiles();
      if (!files.has("pages/index.html")) throw new Error("couldn't find the app's pages");
      // The copy of the default resources for double-clicked pages, made from the CSV online now
      // (it may have been replaced on GitHub since update-resources.sh last ran)
      const csv = files.get("default-resources-cobbler-project.csv");
      if (csv) files.set("resources/data/default-resources-cobbler-project.js", new TextEncoder().encode(
        "// Made from default-resources-cobbler-project.csv. Don't edit: change the CSV.\n" +
        `window.DEFAULT_RESOURCES_CSV = ${JSON.stringify(new TextDecoder().decode(csv).replace(/^\uFEFF/, ""))};\n`));
      const day = new Date().toISOString().slice(0, 10);
      const blob = Zip.create([...files.entries()].sort().map(([path, data]) => ({ name: `the-cobbler-project/${path}`, data })));
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `the-cobbler-project-${day}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      setStatus(`Downloaded the app: ${files.size} files (${(blob.size / 1024 / 1024).toFixed(1)} MB). Unzip it and open pages/index.html.`);
    } catch (err) {
      setStatus(`Couldn't make the ZIP: ${err.message}.`);
    } finally {
      button.disabled = false;
    }
  }

  /* =========================================================
     STORAGE: how full browser storage is, and what's using it
     ========================================================= */

  const mb = (chars) => chars < 1_000_000 ? `${Math.max(1, Math.round(chars / 1000))} KB` : `${(chars / 1_000_000).toFixed(1)} MB`;
  const el = (tag, cls, ...children) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    n.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return n;
  };

  async function renderStorage() {
    const box = $("storage-panel");
    if (!box) return;
    const info = Projects.storageInfo();
    const inDatabase = info.where === "indexeddb";

    let estimate = null, persisted = false;
    try { estimate = await navigator.storage?.estimate?.(); persisted = await navigator.storage?.persisted?.(); } catch {}
    // The meter: projects against localStorage's 5 MB, or everything the site keeps
    // here (projects and files, in the browser's database) against what the browser allows
    const used = inDatabase ? (estimate?.usage ?? info.used) : info.used;
    const limit = inDatabase ? (estimate?.quota || 0) : info.limit;
    const pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
    const bar = el("div", `storage-bar${pct >= 90 ? " is-full" : pct >= 75 ? " is-high" : ""}`, el("span", "storage-fill"));
    bar.firstChild.style.width = `${pct}%`;
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    bar.setAttribute("aria-valuenow", String(pct));
    bar.setAttribute("aria-label", "Storage used");
    const allowance = estimate?.quota ? (estimate.quota >= 1e9 ? `${Math.round(estimate.quota / 1e9)} GB` : `${Math.round(estimate.quota / 1e6)} MB`) : "";
    const siteUse = estimate?.usage != null ? `${(estimate.usage / 1024 / 1024).toFixed(1)} MB used${allowance ? ` of about ${allowance} available` : ""}` : "not available in this browser";
    const safe = persisted ? " · kept safe ✓" : " · the browser may clear it if your disk runs low (click “Keep my files safe”)";

    box.replaceChildren(
      inDatabase
        ? el("p", "storage-line", el("strong", null, `Projects: ${mb(info.plain)}`), " in this browser's database (room for far more than the old 5 MB).")
        : el("p", "storage-line", el("strong", null, `Projects: ${mb(info.used)} of about 5 MB (${pct}%)`),
            pct >= 75 ? " · Getting full: trim old history, delete or archive projects you've backed up, or move long transcripts out." : ""),
      inDatabase
        ? el("p", "storage-line", el("strong", null, "Everything this site keeps here (projects and files): "), siteUse, limit ? ` (${pct}%)` : "", safe)
        : el("p", "storage-line", el("strong", null, "Files: "), siteUse, safe),
      bar,
      !inDatabase && info.compressed && el("p", "storage-line", el("strong", null, "Compressed: "),
        `${mb(info.plain)} of projects stored in ${mb(info.stored)} (${(info.plain / Math.max(1, info.stored)).toFixed(1)}× smaller)`),
      el("table", "storage-table",
        el("thead", null, el("tr", null, el("th", null, "Project"), el("th", null, "Size"), el("th", null, "Biggest parts"))),
        el("tbody", null, info.projects.map(p => el("tr", null,
          el("td", null, p.name),
          el("td", null, mb(p.size)),
          el("td", null, p.keys.slice(0, 3).filter(k => k.size > 50).map(k => `${k.name} ${mb(k.size)}`).join(" · ") || "—"))))),
      housekeeping(info));
  }


  /* =========================================================
     HOUSEKEEPING: transcripts still in projects, archived
     projects, and uploaded files nothing uses any more
     ========================================================= */

  // Ids FileStore uses for its own bookkeeping (never "unused")
  const INTERNAL = /^(sync-|share-base:|undo-merge:|lock:|transcripts-folder-handle)/;

  function transcriptsInProjects() {
    return Projects.list().map(p => {
      const media = Projects.getDataFor(p.id, "media", {}) || {};
      const inside = (Array.isArray(media.transcripts) ? media.transcripts : []).filter(t => !t.storage || t.storage.where === "project");
      return { ...p, count: inside.length, size: inside.reduce((n, t) => n + JSON.stringify(t.segments || []).length, 0) };
    }).filter(p => p.count);
  }

  function housekeeping(info) {
    const tx = transcriptsInProjects();
    const archived = Projects.list().filter(p => p.archived);
    const size = (id) => mb(info.projects.find(p => p.id === id)?.size || 0);
    return el("div", "storage-housekeeping",
      el("h3", null, "Housekeeping"),
      tx.length
        ? el("p", "storage-line", el("strong", null, "Transcripts inside projects: "),
            tx.map(p => `${p.name}: ${p.count} (${mb(p.size)})`).join(" · "), ". ",
            "They can be moved to this browser's file storage or a folder (e.g. Google Drive) on ",
            link("media-and-transcripts.html", "Media & Transcripts"), ", which keeps shared files small and lets collaborators share one copy (one project at a time: switch project first).")
        : el("p", "storage-line", el("strong", null, "Transcripts: "), "none are kept inside projects."),
      archived.length > 0 && el("div", null,
        el("p", "storage-line", el("strong", null, "Archived projects: "), "download a backup (with its files) and remove it from this browser to free space. Import the backup to bring it back."),
        el("ul", "storage-archived", archived.map(p => el("li", null, `${p.name} (${size(p.id)}) `,
          button("Back up and remove", () => backUpAndRemove(p)))))),
      el("p", "storage-line", el("strong", null, "Unused files: "), "uploads and moved transcripts that no project uses any more (e.g. from deleted projects). ",
        button("Find unused files", findUnused)));
  }

  function link(href, text) { const a = el("a", null, text); a.href = href; return a; }
  function button(text, onclick) {
    const b = el("button", "small-btn", text);
    b.type = "button";
    b.addEventListener("click", onclick);
    return b;
  }

  async function backUpAndRemove(p) {
    if (!confirm(`Download a backup of “${p.name}” (with its files) and then remove it from this browser?`)) return;
    const done = await window.ProjectShare?.download(p.id);
    if (!done) { $("storage-status").textContent = "Couldn't make the backup, so nothing was removed."; return; }
    // Give the download a moment to start before removing
    setTimeout(() => {
      if (!confirm(`Did “${done.name}” download? Click OK to remove “${p.name}” from this browser.`)) return;
      Projects.removeById(p.id);
      $("storage-status").textContent = `Removed “${p.name}”. To bring it back: Projects › Import, and pick ${done.name}.`;
      renderStorage();
    }, 800);
  }

  async function unusedFiles() {
    const used = new Set();
    Projects.list().forEach(p => window.ProjectShare.strings(Projects.snapshot(p.id), used));
    const keys = (await FileStore.keys()).map(String);
    return keys.filter(k => !INTERNAL.test(k) && !used.has(k));
  }

  async function findUnused() {
    if (!window.FileStore || !window.ProjectShare) return;
    const status = $("storage-status");
    let unused = [];
    try { unused = await unusedFiles(); } catch (error) { status.textContent = `Couldn't read the files: ${error.message || error}.`; return; }
    if (!unused.length) { status.textContent = "No unused files: every file belongs to a project."; return; }
    let bytes = 0;
    for (const k of unused) { try { bytes += (await FileStore.get(k))?.size || 0; } catch {} }
    const one = unused.length === 1;
    if (!confirm(`${unused.length} file${one ? "" : "s"} (${mb(bytes)}) ${one ? "isn't" : "aren't"} used by any project. Delete ${one ? "it" : "them"}? (Undo can't bring ${one ? "it" : "them"} back.)`)) {
      status.textContent = "Nothing deleted.";
      return;
    }
    for (const k of unused) { try { await FileStore.remove(k); } catch {} }
    status.textContent = `Deleted ${unused.length} unused file${unused.length === 1 ? "" : "s"}.`;
    renderStorage();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("app-zip").addEventListener("click", downloadApp);
    renderStorage();
    document.addEventListener("projects-refresh", (event) => { renderStorage(); event.detail.handled = true; });
    $("storage-trim").addEventListener("click", () => {
      if (!confirm("Remove activity history older than 90 days, and old deletion records, from every project? Your work isn't touched.")) return;
      const before = Projects.storageInfo().used;
      Projects.trimHistory(90);
      $("storage-status").textContent = `Freed ${mb(Math.max(0, before - Projects.storageInfo().used))}.`;
      renderStorage();
    });
    $("storage-persist").addEventListener("click", async () => {
      let ok = false;
      try { ok = await navigator.storage?.persist?.(); } catch {}
      $("storage-status").textContent = ok ? "Done: the browser won't clear your files to free space." : "The browser said no (it decides by how often you use the site). Back up regularly.";
      renderStorage();
    });
    $("storage-backup").addEventListener("click", () => { Projects.backupAll(); $("storage-status").textContent = "Backup downloaded."; });
  });

  window.AppDownload = { collectFiles };
})();
