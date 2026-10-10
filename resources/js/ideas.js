/* =========================================================
   ideas.js — the Ideas page
   ---------------------------------------------------------
   A three-column board for drafting random notes and ideas.
   Saved inside the active project:

     project.data.ideaColumns = ["Raw ideas", "Developing", "Ready to pitch"]
     project.data.ideas = [{ id, column: 0 | 1 | 2, text, created }, ...]
       (cards keep their order within a column)

   Type straight into a card; empty cards disappear when you
   click away. Drag a card by ⠿ to move it, or use ← →.
   "Pitch it →" starts a pitch from the card on the Pitches page.

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("ideas.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const DEFAULT_COLUMNS = ["Raw ideas", "Developing", "Ready to pitch"];

  const el = Cobbler.el;

  const newId = () => Cobbler.newId("i");


  /* ---------- Saved data ---------- */

  let columns, ideas;
  function loadData() {
    columns = Projects.getData("ideaColumns", DEFAULT_COLUMNS);
    if (!Array.isArray(columns) || columns.length !== 3) columns = [...DEFAULT_COLUMNS];
    ideas = Projects.getData("ideas", []);
    if (!Array.isArray(ideas)) ideas = [];
    ideas.forEach(i => { i.column = [0, 1, 2].includes(i.column) ? i.column : 0; i.text ??= ""; });
  }
  loadData();

  let saveTimer = 0;
  function save({ soon = false } = {}) {
    clearTimeout(saveTimer);
    const write = () => {
      Projects.setData("ideas", ideas.filter(i => i.text.trim()));   // empty cards are never saved
      Projects.setData("ideaColumns", columns);
    };
    if (soon) saveTimer = setTimeout(write, 400); else write();
  }
  window.addEventListener("pagehide", () => { clearTimeout(saveTimer); Projects.setData("ideas", ideas.filter(i => i.text.trim())); });

  let editing = null;   // a new card that hasn't been typed in yet
  let dragged = null;


  /* =========================================================
     DRAWING THE BOARD
     ========================================================= */

  function render({ focusId } = {}) {
    const board = document.getElementById("ideas-board");
    board.replaceChildren(...columns.map((title, c) => column(title, c)));
    if (focusId) board.querySelector(`[data-id="${focusId}"] textarea`)?.focus();
  }

  function column(title, c) {
    const cards = ideas.filter(i => i.column === c);

    const name = el("input", { class: "ideas-title", value: title, maxlength: "40", "aria-label": `Column ${c + 1} name` });
    name.addEventListener("change", () => { columns[c] = name.value.trim() || DEFAULT_COLUMNS[c]; name.value = columns[c]; save(); });

    const list = el("ol", { class: "ideas-cards", "aria-label": title }, cards.map(card));
    if (!cards.length) list.append(el("li", { class: "ideas-empty" }, "Nothing here yet"));

    // Drop a dragged card into this column (above the card the pointer is over)
    list.addEventListener("dragover", (event) => {
      if (!dragged) return;
      event.preventDefault();
      list.classList.add("is-drop");
    });
    list.addEventListener("dragleave", (event) => { if (!list.contains(event.relatedTarget)) list.classList.remove("is-drop"); });
    list.addEventListener("drop", (event) => {
      event.preventDefault();
      list.classList.remove("is-drop");
      if (!dragged) return;
      const over = [...list.querySelectorAll(".ideas-card")].find(n => {
        const r = n.getBoundingClientRect();
        return event.clientY < r.top + r.height / 2;
      });
      const target = over && ideas.find(i => i.id === over.dataset.id);
      ideas.splice(ideas.indexOf(dragged), 1);
      dragged.column = c;
      ideas.splice(target ? ideas.indexOf(target) : ideas.length, 0, dragged);
      dragged = null;
      save();
      render();
    });

    return el("section", { class: `ideas-column ideas-column--${c + 1}` },
      el("header", { class: "ideas-head" }, name, el("span", { class: "ideas-count" }, String(cards.filter(i => i.text.trim()).length))),
      el("button", { type: "button", class: "small-btn ideas-add", onclick: () => {
        const idea = { id: newId(), column: c, text: "", created: Date.now() };
        // New cards go at the top of the column
        const first = ideas.findIndex(i => i.column === c);
        ideas.splice(first < 0 ? ideas.length : first, 0, idea);
        editing = idea;
        render({ focusId: idea.id });
      } }, "+ Add idea"),
      list);
  }

  function card(idea) {
    const text = el("textarea", { rows: "2", "aria-label": "Idea", placeholder: "Type an idea…" });
    text.value = idea.text;
    text.addEventListener("input", () => { idea.text = text.value; save({ soon: true }); });
    text.addEventListener("blur", () => {
      if (editing === idea) editing = null;
      if (!idea.text.trim()) {               // empty cards disappear
        const at = ideas.indexOf(idea);
        if (at >= 0) ideas.splice(at, 1);
        // Take just this card out rather than redrawing the board: the click that
        // caused the blur (e.g. on "+ Add idea" or another card) still lands
        const list = node.parentElement;
        node.remove();
        if (list && !list.querySelector(".ideas-card")) list.append(el("li", { class: "ideas-empty" }, "Nothing here yet"));
        save();
      } else save();
    });

    const move = (delta) => {
      idea.column += delta;
      ideas.splice(ideas.indexOf(idea), 1);
      ideas.push(idea);
      save();
      render();
    };

    const node = el("li", { class: "ideas-card", dataset: { id: idea.id } },
      el("div", { class: "ideas-card-bar" },
        el("span", { class: "ideas-drag", title: "Drag to move", "aria-hidden": "true" }, "⠿"),
        el("button", { type: "button", class: "comment-action", "aria-label": "Move to the previous column", disabled: idea.column === 0, onclick: () => move(-1) }, "←"),
        el("button", { type: "button", class: "comment-action", "aria-label": "Move to the next column", disabled: idea.column === 2, onclick: () => move(1) }, "→"),
        el("button", { type: "button", class: "comment-action ideas-pitch", title: "Start a pitch from this idea", onclick: () => {
          if (!idea.text.trim()) return;
          save();
          location.href = `pitches.html#from-idea=${encodeURIComponent(idea.id)}`;
        } }, "Pitch it →"),
        el("button", { type: "button", class: "comment-action ideas-delete", "aria-label": "Delete idea", onclick: () => {
          if (idea.text.trim().length > 80 && !confirm("Delete this idea?")) return;
          const at = ideas.indexOf(idea);
          if (at >= 0) ideas.splice(at, 1);
          save();
          render();
        } }, "×")),
      text);

    // Only the ⠿ handle starts a drag, so selecting text still works
    const handle = node.querySelector(".ideas-drag");
    handle.addEventListener("pointerdown", () => { node.draggable = true; });
    node.addEventListener("dragstart", (event) => {
      dragged = idea;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", idea.text);
      node.classList.add("is-dragging");
    });
    node.addEventListener("dragend", () => { node.draggable = false; node.classList.remove("is-dragging"); dragged = null; });
    return node;
  }

  document.addEventListener("DOMContentLoaded", () => render());

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    clearTimeout(saveTimer);
    editing = null; dragged = null;
    loadData();
    render();
    event.detail.handled = true;
  });
})();
