/* =========================================================
   zine-sketch.js — the Sketch tab of the Zine Planner
   ---------------------------------------------------------
   Shows a zine's pages as booklet spreads (or all at once)
   and lets you draw and type on them. The drawing itself
   (tools, text boxes, undo) comes from sketch-core.js.

   Each zine page is saved as { strokes: [...], texts: [...] }
   (see sketch-core.js for the details).

   Used by zine-planner.js:
     ZineSketch.mount(panel, zine, { save, ratio })
     ZineSketch.unmount()
     ZineSketch.preview(page, ratio)   → a small read-only page
   ========================================================= */
(() => {

  const { el, plural, blankPage } = window.Zine;

  const PREFS_KEY = "zineSketchView";   // remembers "Margin guides" (this browser)


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /* "Front cover", "Page 2", ..., "Back cover" */
  function pageLabel(i, count) {
    if (i === 0) return "Front cover";
    if (i === count - 1) return "Back cover";
    return `Page ${i + 1}`;
  }

  /* Pages as they sit in a folded booklet:
     [cover] [2 3] [4 5] ... [back cover] */
  function spreadsFor(count) {
    const spreads = [[0]];
    for (let i = 1; i < count - 1; i += 2) spreads.push(i + 1 < count - 1 ? [i, i + 1] : [i]);
    spreads.push([count - 1]);
    return spreads;
  }

  /* Left or right page of a spread. The front cover sits on the right
     (like a closed booklet) and the back cover on the left. */
  const sideOf = (spread, n) =>
    spread.length === 1 ? (spread[0] === 0 ? "is-right" : "is-left") : (n === 0 ? "is-left" : "is-right");

  const spreadLabel = (spread, count) =>
    spread.length === 1 ? pageLabel(spread[0], count) : `Pages ${spread[0] + 1}–${spread[1] + 1}`;

  function loadGuides() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY))?.guides === true; } catch { return false; }
  }


  /* =========================================================
     MOUNT / UNMOUNT
     ========================================================= */

  let S = null;   // everything about the open Sketch tab (null when closed)

  function mount(panel, zine, { save, ratio }) {
    unmount();
    S = {
      panel, zine, save, ratio,
      guides: loadGuides(),
      view: "spread",       // "spread" or "all" (overview)
      spreadIndex: 0,
    };

    S.editor = Sketch.createEditor({
      save,
      onRestore: (page) => showPage(zine.pages.indexOf(page)),
      onToolChange: () => { const hint = $1(".sketch-hint"); if (hint) hint.textContent = hintText(); },
      actions: [el("button", { type: "button", class: "small-btn", dataset: { action: "clear" }, onclick: clearSpread }, "Clear")],
    });

    panel.append(S.editor.toolbar, buildNav(), el("div", { class: "sketch-stage" }));
    window.addEventListener("resize", sizeStage);
    renderStage();
  }

  function unmount() {
    if (!S) return;
    S.editor.destroy();
    window.removeEventListener("resize", sizeStage);
    S = null;
  }

  const $$ = (selector) => S.panel.querySelectorAll(selector);
  const $1 = (selector) => S.panel.querySelector(selector);


  /* =========================================================
     PAGE NAVIGATION
     ========================================================= */

  function buildNav() {
    const select = el("select", { class: "spread-select", "aria-label": "Go to page" });
    select.addEventListener("change", () => { S.spreadIndex = Number(select.value); S.view = "spread"; renderStage(); });

    const guides = el("input", { type: "checkbox", checked: S.guides });
    guides.addEventListener("change", () => {
      S.guides = guides.checked;
      try { localStorage.setItem(PREFS_KEY, JSON.stringify({ guides: S.guides })); } catch {}
      $1(".sketch-stage").classList.toggle("show-guides", S.guides);
    });

    return el("div", { class: "sketch-nav" },
      el("div", { class: "tool-group" },
        el("button", { type: "button", class: "small-btn", dataset: { action: "prev" }, "aria-label": "Previous pages", onclick: () => step(-1) }, "‹"),
        select,
        el("button", { type: "button", class: "small-btn", dataset: { action: "next" }, "aria-label": "Next pages", onclick: () => step(1) }, "›")),
      el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "View" },
        el("button", { type: "button", dataset: { view: "spread" }, onclick: () => setView("spread") }, "Spread"),
        el("button", { type: "button", dataset: { view: "all" }, onclick: () => setView("all") }, "All pages")),
      el("div", { class: "tool-group zine-page-tools" },
        el("span", { class: "page-count" }),
        el("span", { class: "zine-page-buttons", role: "group", "aria-label": "Add or remove pages" },
          el("button", { type: "button", class: "comment-action", title: "Add 1 page before the back cover", onclick: () => addPages(1) }, "+1"),
          el("button", { type: "button", class: "comment-action", title: "Add 2 pages before the back cover", onclick: () => addPages(2) }, "+2"),
          el("button", { type: "button", class: "comment-action", title: "Add 4 pages (one folded sheet) before the back cover", onclick: () => addPages(4) }, "+4"),
          el("button", { type: "button", class: "comment-action", dataset: { action: "remove-1" }, title: "Remove the last inside page", onclick: () => removePages(1) }, "−1"),
          el("button", { type: "button", class: "comment-action", dataset: { action: "remove-2" }, title: "Remove the last 2 inside pages", onclick: () => removePages(2) }, "−2"),
          el("button", { type: "button", class: "comment-action", dataset: { action: "remove-pages" }, title: "Remove the last 4 inside pages", onclick: () => removePages(4) }, "−4")),
        el("span", { class: "media-muted zine-page-note", role: "status" })),
      el("label", { class: "tool-group" }, guides, "Margin guides"));
  }

  function updateNav() {
    const count = S.zine.pages.length;
    const spreads = spreadsFor(count);
    const select = $1(".spread-select");
    select.replaceChildren(...spreads.map((spread, i) => el("option", { value: String(i) }, spreadLabel(spread, count))));
    select.value = String(S.spreadIndex);
    $1("[data-action=prev]").disabled = S.view !== "spread" || S.spreadIndex === 0;
    $1("[data-action=next]").disabled = S.view !== "spread" || S.spreadIndex === spreads.length - 1;
    $$(".view-toggle [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === S.view)));
    $1(".page-count").textContent = plural(count, "page");
    // A folded booklet needs a multiple of 4; say how many blanks printing would add
    const short = (4 - (count % 4)) % 4;
    $1(".zine-page-note").textContent = short ? `(a folded booklet needs a multiple of 4: ${plural(short, "blank page")} at the end when printed)` : "";
    $1("[data-action=remove-1]").disabled = count <= 2;
    $1("[data-action=remove-2]").disabled = count <= 3;
    $1("[data-action=remove-pages]").disabled = count <= 5;
    $1("[data-action=clear]").disabled = S.view !== "spread";
  }

  function step(delta) {
    S.spreadIndex = clamp(S.spreadIndex + delta, 0, spreadsFor(S.zine.pages.length).length - 1);
    renderStage();
  }

  function setView(view) {
    S.view = view;
    renderStage();
  }

  // Opens the spread that holds page i
  function showPage(i) {
    S.view = "spread";
    S.spreadIndex = Math.max(0, spreadsFor(S.zine.pages.length).findIndex(spread => spread.includes(i)));
    renderStage();
  }

  /* ---------- Adding and removing pages (1, 2 or 4 at a time; 4 = one folded sheet) ---------- */

  function addPages(n = 4) {
    const pages = S.zine.pages;
    if (pages.length + n > 96) { alert("A zine can have up to 96 pages here."); return; }
    pages.splice(pages.length - 1, 0, ...Array.from({ length: n }, blankPage));
    S.editor.clearHistory();   // pages moved, so old undo steps no longer fit
    S.save();
    showPage(pages.length - 1 - n);
  }

  function removePages(n = 4) {
    const pages = S.zine.pages;
    if (pages.length - n < 2) return;   // keep at least a front and a back
    const first = pages.length - 1 - n;   // the last n inside pages, before the back cover
    const doomed = pages.slice(first, first + n);
    if (doomed.some(p => !Sketch.isEmpty(p)) &&
        !confirm(`Remove ${n === 1 ? `page ${first + 1}` : `pages ${first + 1}–${first + n}`}? ${n === 1 ? "It has" : "They have"} drawings or text, and this can't be undone.`)) return;
    pages.splice(first, n);
    S.editor.clearHistory();
    S.save();
    S.spreadIndex = Math.min(S.spreadIndex, spreadsFor(pages.length).length - 1);
    renderStage();
  }

  function clearSpread() {
    const spread = spreadsFor(S.zine.pages.length)[S.spreadIndex];
    if (S.editor.clear(spread.map(i => S.zine.pages[i]))) renderStage();
  }


  /* =========================================================
     THE STAGE (the spread you're editing, or the overview)
     ========================================================= */

  function renderStage() {
    S.editor.reset();
    const stage = $1(".sketch-stage");
    stage.replaceChildren();
    stage.dataset.view = S.view;
    stage.classList.toggle("show-guides", S.guides);
    stage.style.setProperty("--ratio", S.ratio);

    const count = S.zine.pages.length;
    const spreads = spreadsFor(count);
    S.spreadIndex = clamp(S.spreadIndex, 0, spreads.length - 1);
    updateNav();

    if (S.view === "all") { renderOverview(stage, spreads, count); return; }

    const spread = spreads[S.spreadIndex];
    const row = el("div", { class: "sketch-spread" });
    spread.forEach((i, n) => {
      row.append(el("figure", { class: `zine-sheet ${sideOf(spread, n)}` },
        S.editor.page(S.zine.pages[i], S.ratio),
        el("figcaption", {}, pageLabel(i, count))));
    });
    stage.append(row, el("p", { class: "sketch-hint" }, hintText()));
    sizeStage();
  }

  function hintText() {
    if (S.editor.tool() === "text") return "Click a page to add text. Drag ⠿ to move a box, and its right edge to change the width.";
    return "Draw with a mouse, finger or tablet pen. Pen pressure changes the line width.";
  }

  /* Fits the spread on screen: as wide as the stage allows, but no taller than most of the window */
  function sizeStage() {
    if (!S || S.view !== "spread") return;
    const stage = $1(".sketch-stage");
    const maxHeight = Math.max(280, window.innerHeight * 0.75);
    const pageWidth = Math.min(stage.clientWidth / 2, maxHeight * S.ratio);
    stage.style.setProperty("--page-w", `${Math.floor(pageWidth)}px`);
  }

  /* The overview: every spread as a small thumbnail. Click one to open it. */
  function renderOverview(stage, spreads, count) {
    const grid = el("div", { class: "sketch-overview" });
    spreads.forEach((spread, si) => {
      const pages = el("div", { class: "overview-pages" });
      spread.forEach((i, n) => {
        const thumb = Sketch.preview(S.zine.pages[i], S.ratio);
        thumb.classList.add(sideOf(spread, n));
        pages.append(thumb);
      });
      grid.append(el("button", {
        type: "button",
        class: "overview-spread" + (si === S.spreadIndex ? " is-current" : ""),
        onclick: () => { S.spreadIndex = si; setView("spread"); },
      }, pages, el("span", { class: "overview-label" }, spreadLabel(spread, count))));
    });
    stage.append(grid);
  }


  /* ---------- Let zine-planner.js use the Sketch tab ---------- */
  window.ZineSketch = { mount, unmount, preview: (page, ratio) => Sketch.preview(page, ratio) };
})();
