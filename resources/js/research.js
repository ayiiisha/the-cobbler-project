/* =========================================================
   research.js — the Research page
   ---------------------------------------------------------
   Research notes, saved inside the active project:

     project.data.research = [{
       id, title, status: "unverified" | "verified" | "disputed",
       claim,      the exact quote or figure to check
       sources: ["https://…", "Council report, p. 12", ...],
       body, tags: ["housing", ...], created, updated
     }, ...]

   Filter by status (with counts) and tag, or search. Change a
   note's status straight from its card.

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("research.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);

  // Each status has an icon and a word, so it's never shown by colour alone
  const STATUSES = {
    unverified: { name: "Unverified", icon: "?" },
    verified:   { name: "Verified",   icon: "✓" },
    disputed:   { name: "Disputed",   icon: "⚠" },
  };

  const el = Cobbler.el;

  const newId = () => Cobbler.newId("r");
  const formatDate = Cobbler.formatDate;   // a time in ms → "20 Oct 2026"

  /* Only http, https and mailto links become clickable */
  function safeUrl(value) {
    const v = String(value || "").trim();
    if (!/^(https?:\/\/|mailto:|www\.)/i.test(v) || /\s/.test(v)) return null;
    try {
      const url = new URL(/^www\./i.test(v) ? "https://" + v : v);
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }


  /* ---------- Saved data ---------- */

  let notes = [];
  function loadData() {
    notes = Projects.getData("research", []);
    if (!Array.isArray(notes)) notes = [];
    notes.forEach(n => {
    n.status = STATUSES[n.status] ? n.status : "unverified";
    n.tags = Array.isArray(n.tags) ? n.tags : [];
    // Notes from before several sources were possible had one `source`
    if (!Array.isArray(n.sources)) n.sources = n.source ? [n.source] : [];
    delete n.source;
    for (const key of ["title", "claim", "body"]) n[key] ??= "";
    });
  }
  loadData();
  const save = () => Projects.setData("research", notes);

  const view = { status: "", tag: "", search: "" };
  const allTags = () => [...new Set(notes.flatMap(n => n.tags))].sort((a, b) => a.localeCompare(b));


  /* =========================================================
     DRAWING THE PAGE
     ========================================================= */

  function visibleNotes() {
    const words = view.search.trim().toLowerCase();
    return notes
      .filter(n => !view.status || n.status === view.status)
      .filter(n => !view.tag || n.tags.includes(view.tag))
      .filter(n => !words || [n.title, n.claim, ...n.sources, n.body, ...n.tags].join(" ").toLowerCase().includes(words))
      .sort((a, b) => b.updated - a.updated);
  }

  function render() {
    // Status filter with counts
    const counts = Object.fromEntries(Object.keys(STATUSES).map(s => [s, notes.filter(n => n.status === s).length]));
    const statusButton = (value, text) => el("button", {
      type: "button", "aria-pressed": String(view.status === value),
      onclick: () => { view.status = value; render(); },
    }, text);
    $("research-status").replaceChildren(
      statusButton("", `All (${notes.length})`),
      ...Object.entries(STATUSES).map(([id, s]) => statusButton(id, `${s.icon} ${s.name} (${counts[id]})`)));

    // Tag filter
    const tags = allTags();
    if (view.tag && !tags.includes(view.tag)) view.tag = "";
    $("research-tags").replaceChildren(...(tags.length ? [
      el("span", { class: "research-tags-label" }, "Tags:"),
      ...tags.map(t => el("button", {
        type: "button", class: "team-chip team-chip--toggle", "aria-pressed": String(view.tag === t),
        onclick: () => { view.tag = view.tag === t ? "" : t; render(); },
      }, t)),
    ] : []));
    $("research-tag-list").replaceChildren(...tags.map(t => el("option", { value: t })));

    // Cards
    const list = visibleNotes();
    const grid = $("research-grid");
    if (!notes.length) {
      grid.replaceChildren(el("p", { class: "media-empty" }, "No research notes yet. Add one for each claim, figure or lead you need to check."));
      return;
    }
    if (!list.length) {
      grid.replaceChildren(el("p", { class: "media-empty" }, "No notes match. Clear the search or pick All."));
      return;
    }
    grid.replaceChildren(...list.map(card));
  }

  function card(n) {
    // Change status right from the card
    const status = el("select", { class: `research-status-select is-${n.status}`, "aria-label": `Status of ${n.title}` },
      Object.entries(STATUSES).map(([id, s]) => el("option", { value: id }, `${s.icon} ${s.name}`)));
    status.value = n.status;
    status.addEventListener("change", () => {
      n.status = status.value;
      n.updated = Date.now();
      save();
      render();
    });

    return el("article", { class: `research-card is-${n.status}` },
      el("header", { class: "research-card-head" },
        el("h3", {}, n.title || "Untitled"),
        status),
      n.claim && el("blockquote", { class: "research-claim" },
        el("span", { class: "research-label" }, "To check"), n.claim),
      n.sources.length > 0 && el("div", { class: "research-source" },
        el("span", { class: "research-label" }, n.sources.length === 1 ? "Source" : `Sources (${n.sources.length})`),
        el("ol", { class: "research-source-items" }, n.sources.map(src => {
          const href = safeUrl(src);
          return el("li", {}, href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, src) : src);
        }))),
      n.body && el("p", { class: "research-body" }, n.body),
      n.tags.length > 0 && el("ul", { class: "team-chips team-chips--static", "aria-label": "Tags" },
        n.tags.map(t => el("li", {}, el("button", { type: "button", class: "team-chip research-tag", onclick: () => { view.tag = t; render(); } }, t)))),
      el("footer", { class: "research-card-foot" },
        el("span", { class: "media-muted" }, `Edited ${formatDate(n.updated)}`),
        el("button", { type: "button", class: "comment-action", onclick: () => openDialog(n) }, "Edit")));
  }


  /* =========================================================
     ADD / EDIT DIALOG
     ========================================================= */

  let editing = null;
  let chosenStatus = "unverified";

  /* One box per source; Enter in a box adds the next one */
  function drawSources(list, focusIndex) {
    const box = $("research-source-list");
    box.replaceChildren(...list.map((text, i) => {
      const input = el("input", { value: text, maxlength: "500", autocomplete: "off", "aria-label": `Source ${i + 1}`,
                                  placeholder: "Link, document, person, page number…" });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        drawSources([...readSources().slice(0, i + 1), "", ...readSources().slice(i + 1)], i + 1);
      });
      return el("li", {}, input,
        el("button", { type: "button", class: "goal-item-remove research-source-remove", "aria-label": `Remove source ${i + 1}`,
          onclick: () => { const all = readSources(); all.splice(i, 1); drawSources(all.length ? all : [""]); } }, "×"));
    }));
    if (focusIndex != null) box.children[focusIndex]?.querySelector("input").focus();
  }
  const readSources = () => [...$("research-source-list").querySelectorAll("input")].map(i => i.value);

  function drawStatusChoices() {
    $("research-status-options").replaceChildren(...Object.entries(STATUSES).map(([id, s]) =>
      el("button", {
        type: "button", class: `team-chip team-chip--toggle research-pick is-${id}`, "aria-pressed": String(chosenStatus === id),
        onclick: () => { chosenStatus = id; drawStatusChoices(); },
      }, `${s.icon} ${s.name}`)));
  }

  function openDialog(note = null) {
    editing = note;
    const form = $("research-form");
    form.reset();
    for (const key of ["title", "claim", "body"]) form.elements[key].value = note?.[key] || "";
    drawSources(note?.sources.length ? note.sources : [""]);
    form.elements.tags.value = note ? note.tags.join(", ") : (view.tag || "");
    chosenStatus = note?.status || "unverified";
    drawStatusChoices();
    $("research-dialog-title").textContent = note ? "Edit note" : "New note";
    $("research-delete").hidden = !note;
    $("research-dialog").showModal();
    form.elements.title.focus();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const dialog = $("research-dialog");
    const form = $("research-form");

    $("research-new").addEventListener("click", () => openDialog());
    $("research-source-add").addEventListener("click", () => {
      const all = readSources();
      drawSources([...all, ""], all.length);
    });
    $("research-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

    $("research-delete").addEventListener("click", () => {
      if (!editing || !confirm(`Delete the note “${editing.title}”?`)) return;
      notes = notes.filter(n => n !== editing);
      save();
      dialog.close();
      render();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const fields = { status: chosenStatus, updated: Date.now() };
      for (const key of ["title", "claim", "body"]) fields[key] = String(data.get(key) || "").trim();
      fields.sources = readSources().map(s => s.trim()).filter(Boolean);
      // Tags: split on commas, tidy, no repeats (matching existing tags regardless of capitals)
      const existing = allTags();
      fields.tags = [...new Set(String(data.get("tags") || "").split(",").map(t => t.trim()).filter(Boolean)
        .map(t => existing.find(e => e.toLowerCase() === t.toLowerCase()) || t))];

      if (editing) Object.assign(editing, fields);
      else notes.push({ id: newId(), created: Date.now(), ...fields });
      save();
      dialog.close();
      render();
    });

    $("research-search").addEventListener("input", (event) => { view.search = event.target.value; render(); });
    render();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => { loadData(); render(); event.detail.handled = true; });
})();
