/* =========================================================
   zine-planner.js — the Zine Planner page
   ---------------------------------------------------------
   A zine lives inside the active project, under the key "zines":

     project.data.zines = [{
       id, name, size, orientation, created, updated,
       pages: [{ strokes: [...], texts: [...] }, ...],   ← Sketch
       files: [{ id, blob, name, type, size, added,      ← Critique
                 comments: [thread, ...] }, ...],
     }, ...]

   This file:
     1. Page sizes and presets
     2. The zine library (cards, new / edit / duplicate / delete)
     3. The open zine, with its two tabs:
          Sketch   → zine-sketch.js
          Critique → zine-critique.js

   The address bar remembers what's open, e.g.
     zine-planner.html#zine=z123&tab=critique

   Load order: projects-core.js, comments.js, file-store.js,
   then zine-planner.js → zine-sketch.js → zine-critique.js (defer).
   ========================================================= */
(() => {

  /* ---------- Safety check ---------- */
  if (!window.Projects) {
    console.error("zine-planner.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }


  /* =========================================================
     1. PAGE SIZES AND PRESETS
     ========================================================= */

  /* Every page size (portrait). The metric sizes are the A-series
     names for a half, quarter and eighth of an A4 sheet. */
  const SIZES = {
    "letter-half":    { name: "US Letter Half",    fold: "half",    paper: "letter", w: 5.5,  h: 8.5,  unit: "in" },
    "letter-quarter": { name: "US Letter Quarter", fold: "quarter", paper: "letter", w: 4.25, h: 5.5,  unit: "in" },
    "letter-eighth":  { name: "US Letter Eighth",  fold: "eighth",  paper: "letter", w: 2.75, h: 4.25, unit: "in" },
    "a5":             { name: "A5",                fold: "half",    paper: "a4",     w: 148,  h: 210,  unit: "mm" },
    "a6":             { name: "A6",                fold: "quarter", paper: "a4",     w: 105,  h: 148,  unit: "mm" },
    "a7":             { name: "A7",                fold: "eighth",  paper: "a4",     w: 74,   h: 105,  unit: "mm" },
  };

  /* How each fold is described in the size menu */
  const FOLDS = {
    half:    "Half sheet",
    quarter: "Quarter sheet",
    eighth:  "Eighth sheet",
  };

  /* Presets fill in the size and page count. Paper (US Letter or A4) is picked separately. */
  const PRESETS = [
    { id: "mini",   name: "Mini zine",      fold: "eighth",  pages: 8,  note: "One sheet, folded and cut once" },
    { id: "pocket", name: "Pocket zine",    fold: "quarter", pages: 16, note: "Quarter-size stapled booklet" },
    { id: "half",   name: "Half-size zine", fold: "half",    pages: 12, note: "Sheets folded in half and stapled" },
    { id: "digest", name: "Digest",         fold: "half",    pages: 24, note: "A thicker half-size booklet" },
    { id: "custom", name: "Custom",         note: "Choose your own size and page count" },
  ];

  const sizeIdFor = (paper, fold) =>
    Object.keys(SIZES).find(id => SIZES[id].paper === paper && SIZES[id].fold === fold);

  // "A6 · 105 × 148 mm"
  function sizeLabel(zine) {
    const s = SIZES[zine.size] || SIZES.a6;
    const [w, h] = zine.orientation === "landscape" ? [s.h, s.w] : [s.w, s.h];
    return `${s.name} · ${w} × ${h} ${s.unit}${zine.orientation === "landscape" ? " · landscape" : ""}`;
  }

  // Page width ÷ height
  function pageRatio(zine) {
    const s = SIZES[zine.size] || SIZES.a6;
    return zine.orientation === "landscape" ? s.h / s.w : s.w / s.h;
  }


  /* =========================================================
     SMALL HELPERS (shared with zine-sketch.js and zine-critique.js)
     ========================================================= */

  const $ = (id) => document.getElementById(id);

  const newId = Cobbler.newId;

  const el = Cobbler.el;

  const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  const blankPage = () => ({ strokes: [], texts: [] });

  const plural = Cobbler.plural;


  /* =========================================================
     SAVED DATA
     ========================================================= */

  let zines = [];
  function loadData() {
    zines = Projects.getData("zines", []);
    if (!Array.isArray(zines)) zines = [];
    // Fill in anything missing (e.g. from an older or hand-edited backup)
    zines.forEach(z => {
      z.pages = Array.isArray(z.pages) && z.pages.length ? z.pages : Array.from({ length: 8 }, blankPage);
      z.pages.forEach(p => { p.strokes ||= []; p.texts ||= []; });
      z.files ||= [];
      if (!SIZES[z.size]) z.size = "a6";
    });
  }
  loadData();

  /* Saves every zine. Pass the zine that changed to update its "edited" time. */
  function save(zine) {
    if (zine) zine.updated = Date.now();
    Projects.setData("zines", zines);
  }

  /* Deletes uploaded files that no zine in any project uses any more */
  async function releaseFiles(blobIds) {
    const used = new Set(
      Projects.collect("zines").flat().flatMap(z => (z?.files || []).map(f => f.blob)));
    for (const id of blobIds) {
      if (!used.has(id)) await FileStore.remove(id).catch(() => {});
    }
  }


  /* =========================================================
     ROUTING: what's open (library, or a zine and its tab)
     ========================================================= */

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    return {
      zine: zines.find(z => z.id === params.get("zine")) || null,
      tab: params.get("tab") === "critique" ? "critique" : "sketch",
    };
  }

  // Opens a zine (or the library, if no id). `replace` skips a Back-button step.
  function go(zineId, tab = "sketch", { replace = false } = {}) {
    const hash = zineId ? `#zine=${encodeURIComponent(zineId)}&tab=${tab}` : "";
    if (replace) { history.replaceState(null, "", hash || location.pathname); route(); }
    else if (location.hash !== hash) location.hash = hash || "#";   // "hashchange" then calls route()
    else route();
  }

  let openZine = null;   // the zine on screen, or null for the library
  let openTab = null;

  function route() {
    const { zine, tab } = readHash();
    if (!zine) { closeWorkspace(); showLibrary(); return; }
    if (zine !== openZine) closeWorkspace();
    showWorkspace(zine, tab);
  }


  /* =========================================================
     2. ZINE LIBRARY
     ========================================================= */

  function showLibrary() {
    $("zine-library").hidden = false;
    $("zine-workspace").hidden = true;
    document.title = "Zine Planner";
    renderLibrary();
  }

  function renderLibrary() {
    const grid = $("zine-grid");
    grid.replaceChildren();

    if (!zines.length) {
      grid.append(el("p", { class: "zine-empty" },
        `No zines in “${Projects.activeName()}” yet. Start one with New zine.`));
      return;
    }

    [...zines].sort((a, b) => b.updated - a.updated).forEach(zine => {
      const openComments = zine.files.reduce((n, f) => n + f.comments.filter(c => !c.resolved).length, 0);

      const cover = el("button", {
        type: "button", class: "zine-card-cover", "aria-label": `Open ${zine.name}`,
        onclick: () => go(zine.id, "sketch"),
      });
      cover.append(ZineSketch.preview(zine.pages[0], pageRatio(zine)));

      grid.append(el("article", { class: "zine-card" },
        cover,
        el("div", { class: "zine-card-body" },
          el("h3", {}, zine.name),
          el("p", { class: "zine-card-meta" }, sizeLabel(zine)),
          el("p", { class: "zine-card-meta" },
            `${plural(zine.pages.length, "page")} · ${plural(zine.files.length, "file")}` +
            (openComments ? ` · ${plural(openComments, "open comment")}` : "")),
          el("p", { class: "zine-card-meta" }, `Edited ${formatDate(zine.updated)}`),
          el("div", { class: "zine-card-actions" },
            el("button", { type: "button", class: "small-btn", onclick: () => go(zine.id, "sketch") }, "Sketch"),
            el("button", { type: "button", class: "small-btn", onclick: () => go(zine.id, "critique") }, "Critique"),
            el("button", { type: "button", class: "small-btn", onclick: () => openDialog(zine) }, "Edit"),
            el("button", { type: "button", class: "small-btn", onclick: () => duplicateZine(zine) }, "Duplicate"),
            el("button", { type: "button", class: "small-btn", onclick: () => deleteZine(zine) }, "Delete")))));
    });
  }

  function duplicateZine(zine) {
    const copy = JSON.parse(JSON.stringify(zine));   // a real copy (files share the stored originals)
    copy.id = newId("z");
    copy.name = `${zine.name} (copy)`;
    copy.created = copy.updated = Date.now();
    zines.push(copy);
    save();
    renderLibrary();
  }

  async function deleteZine(zine) {
    const extras = [
      zine.files.length && plural(zine.files.length, "uploaded file"),
      "all its sketches",
    ].filter(Boolean).join(" and ");
    if (!confirm(`Delete “${zine.name}”, including ${extras}? This can't be undone.`)) return;
    zines.splice(zines.indexOf(zine), 1);
    save();
    if (openZine === zine) go(null, undefined, { replace: true });
    else renderLibrary();
    await releaseFiles(zine.files.map(f => f.blob));
  }


  /* =========================================================
     NEW / EDIT ZINE DIALOG
     ========================================================= */

  let editingZine = null;   // null = making a new zine

  /* Fills the size menu with the right names for the chosen paper */
  function fillSizeMenu(paper, fold) {
    const select = $("zine-form").elements.fold;
    select.replaceChildren(...Object.entries(FOLDS).map(([id, label]) => {
      const s = SIZES[sizeIdFor(paper, id)];
      return el("option", { value: id }, `${s.name} — ${s.w} × ${s.h} ${s.unit} (${label.toLowerCase()})`);
    }));
    select.value = fold;
  }

  /* Picking a preset fills in the size and page count */
  function applyPreset(id) {
    const preset = PRESETS.find(p => p.id === id);
    const form = $("zine-form");
    if (!preset || preset.id === "custom") return;
    form.elements.fold.value = preset.fold;
    form.elements.pages.value = preset.pages;
    updateDialogNote();
  }

  /* Changing the size or page count by hand switches the preset to Custom
     (unless the values happen to match a preset) */
  function matchPreset() {
    const form = $("zine-form");
    const match = PRESETS.find(p =>
      p.fold === form.elements.fold.value && p.pages === Number(form.elements.pages.value));
    form.elements.preset.value = match ? match.id : "custom";
  }

  /* Short note under the fields: sheets of paper needed, or a warning when editing */
  function updateDialogNote() {
    const form = $("zine-form");
    const note = $("zine-dialog-note");
    if (editingZine) {
      const changed = editingZine.size !== sizeIdFor(form.elements.paper.value, form.elements.fold.value)
                   || editingZine.orientation !== form.elements.orientation.value;
      note.textContent = changed ? "Sketches stretch to fit the new page shape." : "";
      return;
    }
    const pages = Number(form.elements.pages.value) || 0;
    const fold = form.elements.fold.value;
    const paper = form.elements.paper.value === "letter" ? "US Letter" : "A4";
    if (fold === "eighth" && pages === 8) {
      note.textContent = `Prints on 1 sheet of ${paper} (one side), folded and cut once.`;
    } else {
      const perSheet = { half: 4, quarter: 8, eighth: 16 }[fold];   // pages per double-sided sheet
      const sheets = Math.ceil(pages / perSheet);
      note.textContent = pages ? `About ${plural(sheets, "sheet")} of ${paper}, printed on both sides.` : "";
    }
  }

  function openDialog(zine = null) {
    editingZine = zine;
    const form = $("zine-form");
    form.reset();

    const size = zine ? SIZES[zine.size] : null;
    let lastPaper = "letter";
    try { lastPaper = localStorage.getItem("zinePaper") || "letter"; } catch {}
    const paper = size ? size.paper : lastPaper;
    form.elements.paper.value = paper;
    fillSizeMenu(paper, size ? size.fold : "eighth");
    form.elements.orientation.value = zine?.orientation || "portrait";
    form.elements.name.value = zine?.name || "";

    $("zine-dialog-title").textContent = zine ? "Edit zine" : "New zine";
    $("zine-submit").textContent = zine ? "Save changes" : "Create zine";
    $("zine-presets").hidden = !!zine;
    $("zine-pages-field").hidden = !!zine;   // page count is changed in Sketch

    if (!zine) {
      form.elements.preset.value = "mini";
      applyPreset("mini");
    }
    updateDialogNote();
    $("zine-dialog").showModal();
    form.elements.name.focus();
  }

  function setUpDialog() {
    const dialog = $("zine-dialog");
    const form = $("zine-form");

    // Preset cards
    $("zine-preset-options").append(...PRESETS.map(p =>
      el("label", { class: "zine-preset" },
        el("input", { type: "radio", name: "preset", value: p.id }),
        el("span", { class: "zine-preset-name" }, p.name),
        el("span", { class: "zine-preset-note" },
          p.pages ? `${p.pages} pages · ${FOLDS[p.fold].toLowerCase()}` : "", el("br"), p.note))));

    form.addEventListener("change", (event) => {
      const name = event.target.name;
      if (name === "preset") applyPreset(event.target.value);
      if (name === "paper") {
        fillSizeMenu(event.target.value, form.elements.fold.value);
        try { localStorage.setItem("zinePaper", event.target.value); } catch {}
      }
      if (name === "fold" || name === "pages") matchPreset();
      updateDialogNote();
    });
    form.elements.pages.addEventListener("input", () => { matchPreset(); updateDialogNote(); });

    // Close with Cancel or a click on the dimmed area
    $("zine-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name")).trim() || "Untitled zine";
      const size = sizeIdFor(String(data.get("paper")), String(data.get("fold")));
      const orientation = data.get("orientation") === "landscape" ? "landscape" : "portrait";

      if (editingZine) {
        Object.assign(editingZine, { name, size, orientation });
        save(editingZine);
        dialog.close();
        if (openZine === editingZine) unmountTabs();   // redraw with the new page shape
        route();
        return;
      }

      // Page count: a multiple of 4 (every folded sheet adds 4 pages), 4–96
      let pages = Math.round((Number(data.get("pages")) || 8) / 4) * 4;
      pages = Math.min(96, Math.max(4, pages));

      const zine = {
        id: newId("z"), name, size, orientation,
        created: Date.now(), updated: Date.now(),
        pages: Array.from({ length: pages }, blankPage),
        files: [],
      };
      zines.push(zine);
      save();
      dialog.close();
      go(zine.id, "sketch");
    });
  }


  /* =========================================================
     3. THE OPEN ZINE (Sketch / Critique tabs)
     ========================================================= */

  function showWorkspace(zine, tab) {
    openZine = zine;
    $("zine-library").hidden = true;
    $("zine-workspace").hidden = false;
    document.title = `${zine.name} · Zine Planner`;

    $("zine-title").textContent = zine.name;
    $("zine-meta").textContent = sizeLabel(zine);

    // Tabs
    document.querySelectorAll("#zine-tabs [role=tab]").forEach(button => {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    $("panel-sketch").hidden = tab !== "sketch";
    $("panel-critique").hidden = tab !== "critique";

    // Only the visible tab is running
    if (tab === openTab) return;
    unmountTabs();
    openTab = tab;
    const options = { save: () => save(zine), ratio: pageRatio(zine) };
    if (tab === "sketch") ZineSketch.mount($("panel-sketch"), zine, options);
    else ZineCritique.mount($("panel-critique"), zine, options);
  }

  function unmountTabs() {
    ZineSketch.unmount();
    ZineCritique.unmount();
    $("panel-sketch").replaceChildren();
    $("panel-critique").replaceChildren();
    openTab = null;
  }

  function closeWorkspace() {
    if (!openZine) return;
    unmountTabs();
    openZine = null;
  }

  function setUpWorkspace() {
    $("zine-back").addEventListener("click", (event) => {
      event.preventDefault();
      go(null);
    });
    $("zine-edit").addEventListener("click", () => openDialog(openZine));

    // Tabs: click, or arrow keys between them
    const tabs = [...document.querySelectorAll("#zine-tabs [role=tab]")];
    tabs.forEach((button, i) => {
      button.addEventListener("click", () => { if (openZine) go(openZine.id, button.dataset.tab, { replace: true }); });
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const next = tabs[(i + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      });
    });
  }


  /* =========================================================
     START-UP
     ========================================================= */

  window.Zine = { el, newId, plural, formatDate, blankPage, releaseFiles };

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    setUpWorkspace();
    $("zine-new").addEventListener("click", () => openDialog());
    window.addEventListener("hashchange", route);
    route();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    closeWorkspace();   // (saves anything the drawing editor still had waiting)
    loadData();
    route();
    event.detail.handled = true;
  });
})();
