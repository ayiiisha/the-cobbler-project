/* =========================================================
   ideas-panel.js — the project's ideas, on any page
   ---------------------------------------------------------
   A round "lightbulb" button (above the person button) opens a
   panel on the right with the Ideas board's cards, column by
   column, so ideas are at hand while you work on another page:
   jot a new one, edit, move it along, or drop it. The panel
   stays open from page to page until you close it (remembered
   in this browser as "ideasPanelOpen").

   The cards are the same data as the Ideas page
   (project.data.ideas and ideaColumns: see ideas.js), so the
   panel isn't shown on the Ideas page itself.

   Needs projects-core.js. Loads on every page (boot.js).
   ========================================================= */
(() => {

  if (!window.Projects) return;

  const { el, $, newId } = Cobbler;
  const OPEN_KEY = "ideasPanelOpen";
  const DEFAULT_COLUMNS = ["Raw ideas", "Developing", "Ready to pitch"];

  const BULB = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.6.5.9 1.2.9 1.9v.4h6v-.4c0-.7.3-1.4.9-1.9A6.5 6.5 0 0 0 12 2.5zM9.5 19h5M10.5 21.5h3"
            fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  const template = `
    <button type="button" class="fab ideas-fab" id="ideas-fab"
            aria-controls="ideas-drawer" aria-expanded="false" title="Ideas">
      ${BULB}
      <span class="visually-hidden">Ideas</span>
    </button>

    <aside class="ideas-drawer" id="ideas-drawer" aria-labelledby="ideas-drawer-title" hidden>
      <div class="panel-head">
        <div>
          <h2 id="ideas-drawer-title">Ideas</h2>
          <p class="comments-project">in <span id="ideas-drawer-project"></span></p>
        </div>
        <button type="button" class="small-btn" id="ideas-drawer-close" aria-label="Close ideas">×</button>
      </div>
      <form class="ideas-drawer-add" id="ideas-drawer-form">
        <label class="visually-hidden" for="ideas-drawer-text">New idea</label>
        <textarea id="ideas-drawer-text" rows="2" maxlength="2000" placeholder="Jot an idea… (Enter adds it)"></textarea>
        <button type="submit" class="small-btn">Add</button>
      </form>
      <div id="ideas-drawer-columns" class="ideas-drawer-columns"></div>
      <p class="media-muted"><a href="ideas.html" id="ideas-drawer-link">Open the Ideas page</a> to drag cards around or pitch one.</p>
    </aside>
  `;


  /* ---------- Saved data (read fresh every time: other pages save too) ---------- */

  function data() {
    let columns = Projects.getData("ideaColumns", DEFAULT_COLUMNS);
    if (!Array.isArray(columns) || columns.length !== 3) columns = [...DEFAULT_COLUMNS];
    let ideas = Projects.getData("ideas", []);
    if (!Array.isArray(ideas)) ideas = [];
    return { columns, ideas };
  }
  const saveIdeas = (ideas) => Projects.setData("ideas", ideas.filter(i => String(i.text || "").trim()));


  /* ---------- Drawing ---------- */

  let saveTimer = 0;
  const isOpen = () => !$("ideas-drawer")?.hidden;

  function render() {
    if (!isOpen()) return;
    const { columns, ideas } = data();
    $("ideas-drawer-project").textContent = Projects.activeName();
    $("ideas-drawer-columns").replaceChildren(...columns.map((title, c) => {
      const cards = ideas.filter(i => ([0, 1, 2].includes(i.column) ? i.column : 0) === c);
      return el("section", { class: "ideas-drawer-column" },
        el("h3", {}, title, " ", el("span", { class: "ideas-count" }, String(cards.length))),
        cards.length
          ? el("ol", { class: "ideas-drawer-cards" }, cards.map(idea => card(idea, c, ideas)))
          : el("p", { class: "ideas-empty" }, "Nothing here yet"));
    }));
  }

  function card(idea, c, ideas) {
    const text = el("textarea", { rows: 1, "aria-label": "Idea", maxlength: "2000" }, idea.text || "");
    const grow = () => { text.style.height = "auto"; text.style.height = `${text.scrollHeight}px`; };
    requestAnimationFrame(grow);
    text.addEventListener("input", () => {
      idea.text = text.value;
      grow();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = 0; saveIdeas(ideas); }, 500);
    });
    text.addEventListener("blur", () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveIdeas(ideas); }
      if (!text.value.trim()) render();   // an emptied card goes
    });
    const move = (delta) => { idea.column = c + delta; saveIdeas(ideas); render(); };
    return el("li", { class: "ideas-drawer-card" },
      text,
      el("div", { class: "ideas-drawer-card-bar" },
        el("button", { type: "button", class: "comment-action", "aria-label": "Move to the previous column", disabled: c === 0, onclick: () => move(-1) }, "←"),
        el("button", { type: "button", class: "comment-action", "aria-label": "Move to the next column", disabled: c === 2, onclick: () => move(1) }, "→"),
        el("button", { type: "button", class: "comment-action", "aria-label": "Delete this idea", onclick: () => {
          if (idea.text.trim() && !confirm("Delete this idea?")) return;
          saveIdeas(ideas.filter(i => i !== idea));
          render();
        } }, "×")));
  }

  function add(textValue) {
    const value = textValue.trim();
    if (!value) return;
    const { ideas } = data();
    // New cards go at the top of the first column, as on the Ideas page
    const first = ideas.findIndex(i => (i.column || 0) === 0);
    const idea = { id: newId("i"), column: 0, text: value, created: Date.now() };
    ideas.splice(first === -1 ? ideas.length : first, 0, idea);
    saveIdeas(ideas);
    render();
  }


  /* ---------- Open / close ---------- */

  function setOpen(open, { remember = true } = {}) {
    $("ideas-drawer").hidden = !open;
    $("ideas-fab").setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("ideas-open", open);
    if (remember) { try { localStorage.setItem(OPEN_KEY, String(open)); } catch {} }
    if (open) render();
  }

  const remembered = () => { try { return localStorage.getItem(OPEN_KEY) === "true"; } catch { return false; } };


  /* ---------- Build and wire up ---------- */

  document.addEventListener("DOMContentLoaded", () => {
    if ($("ideas-fab")) return;
    if ($("ideas-board")) return;   // the Ideas page shows the board itself
    document.body.insertAdjacentHTML("beforeend", template);

    $("ideas-fab").addEventListener("click", () => setOpen(!isOpen()));
    $("ideas-drawer-close").addEventListener("click", () => { setOpen(false); $("ideas-fab").focus(); });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen() || event.defaultPrevented) return;
      if (!$("ideas-drawer").contains(document.activeElement)) return;   // only when you're in the panel
      setOpen(false);
      $("ideas-fab").focus();
    });

    const form = $("ideas-drawer-form");
    const text = $("ideas-drawer-text");
    form.addEventListener("submit", (event) => { event.preventDefault(); add(text.value); text.value = ""; text.focus(); });
    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
    });

    // Save pending edits before leaving the page
    window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; saveIdeas(data().ideas); } });

    // Redraw when the project changes, after an undo, or when changes arrive (another tab, a sync folder)
    document.addEventListener("projects-refresh", render);
    document.addEventListener("projects-data-changed", render);
    document.addEventListener("projects-changed", render);

    if (remembered()) setOpen(true, { remember: false });
  });

  window.CobblerIdeas = { open: () => setOpen(true), close: () => setOpen(false), render };
})();
