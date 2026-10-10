/* =========================================================
   screenplay.js — the Screenplay page
   ---------------------------------------------------------
   Write scripts in standard Hollywood format: Courier New 12pt,
   one element per line, each with its own margins:

     Scene heading   INT. KITCHEN - NIGHT          (capitals, full width)
     Action          What we see and hear.         (full width)
     Character               MARIA                 (3.7" from the page edge)
     Parenthetical          (quietly)              (3.1")
     Dialogue            We can't stay here.       (2.5", 3.5" wide)
     Transition                         CUT TO:    (right)
     Shot            CLOSE ON THE LETTER           (capitals)

   Keys, as in Final Draft:
     Enter        next element (after a character → dialogue,
                  after dialogue → action, after a scene heading → action)
     Shift+Enter  a line break inside the element
     Tab          change the element type (or finish a character
                  name / location it suggests); Shift+Tab goes back
     Cmd/Ctrl+1–7 Scene heading, Action, Character, Parenthetical,
                  Dialogue, Transition, Shot
     Backspace at the start of an element joins it to the one above
   In Action, a line starting INT. or EXT. becomes a scene heading,
   a short line in capitals becomes a character, and one ending
   "TO:" becomes a transition, when you press Enter.

   Pages: laid out exactly as printed (Courier is 10 characters
   an inch, 6 lines an inch, 54 lines a page), with (MORE) and
   (CONT'D) when a speech crosses a page, scene headings and
   character names never left at the bottom of a page, page
   numbers from page 2, an optional title page and scene numbers.
   Roughly a page a minute.

   Export: PDF (print), Final Draft (.fdx), Fountain (.fountain:
   opens in Highland, WriterSolo, Fade In, Arc Studio and more).
   Import: Fountain.

   Saved inside the active project:
     project.data.screenplays = [{ id, title, author, basedOn, contact, draftDate,
       sceneNumbers, titlePage, elements: [{ id, type, text }], created, updated }]

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) return;
  const $ = (id) => document.getElementById(id);

  const el = Cobbler.el;

  const newId = Cobbler.newId;
  const slug = (text) => Cobbler.slug(text, "script");


  /* =========================================================
     ELEMENTS
     indent and width are in characters (Courier: 10 to the inch),
     measured from the 1.5" left margin. before = blank lines above.
     ========================================================= */

  const TYPES = {
    scene:         { name: "Scene heading", key: "1", indent: 0,  width: 60, upper: true, before: 1, enter: "action" },
    action:        { name: "Action",        key: "2", indent: 0,  width: 60, before: 1, enter: "action" },
    character:     { name: "Character",     key: "3", indent: 22, width: 38, upper: true, before: 1, enter: "dialogue" },
    parenthetical: { name: "Parenthetical", key: "4", indent: 16, width: 24, before: 0, enter: "dialogue" },
    dialogue:      { name: "Dialogue",      key: "5", indent: 10, width: 35, before: 0, enter: "action" },
    transition:    { name: "Transition",    key: "6", indent: 0,  width: 60, upper: true, before: 1, enter: "scene", right: true },
    shot:          { name: "Shot",          key: "7", indent: 0,  width: 60, upper: true, before: 1, enter: "action" },
  };
  const TAB_ORDER = ["action", "character", "dialogue", "parenthetical", "transition", "scene", "shot"];
  const LINES_PER_PAGE = 54;
  const SPEECH = new Set(["parenthetical", "dialogue"]);


  /* =========================================================
     DATA
     ========================================================= */

  let scripts = [];
  function loadData() {
    const v = Projects.getData("screenplays", []);
    scripts = Array.isArray(v) ? v : [];
    scripts.forEach(normalize);
  }
  loadData();
  function normalize(s) {
    for (const k of ["title", "author", "basedOn", "contact", "draftDate"]) s[k] ??= "";
    s.elements = Array.isArray(s.elements) ? s.elements.filter(e => TYPES[e.type]) : [];
    if (!s.elements.length) s.elements.push({ id: newId("e"), type: "scene", text: "" });
    s.titlePage ??= true;
    s.revisions = Array.isArray(s.revisions) ? s.revisions : [];
    s.activeRevision ??= null;
    s.showRevisions ??= true;
    s.breakdown = Array.isArray(s.breakdown) ? s.breakdown : [];
    return s;
  }
  const currentKey = () => `screenplayCurrent:${Projects.activeId()}`;   // (a function: the project can change without a reload)
  const remembered = () => { try { return localStorage.getItem(currentKey()); } catch { return null; } };
  let currentId = remembered();
  const current = () => scripts.find(s => s.id === currentId) || scripts[0] || null;

  let saveTimer = 0;
  function save({ soon = false } = {}) {
    clearTimeout(saveTimer);
    const write = () => { saveTimer = 0; const s = current(); if (s) s.updated = Date.now(); Projects.setData("screenplays", scripts); renderPages(); };
    if (soon) saveTimer = setTimeout(write, 500); else write();
  }
  window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); Projects.setData("screenplays", scripts); } });

  const setStatus = Cobbler.statusLine("sp-status", 7000);

  let view = "write";     // "write", "pages" or "breakdown"
  let focusId = null;     // the element being edited


  /* =========================================================
     LAYOUT: wrapping and pages (also used for print and page count)
     ========================================================= */

  // Word-wraps text to a width in characters (words longer than the width are split)
  function wrap(text, width) {
    const out = [];
    String(text).split("\n").forEach(para => {
      const words = para.split(/ +/);
      let line = "";
      words.forEach(w => {
        while (w.length > width) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, width)); w = w.slice(width); }
        if (!line) line = w;
        else if (line.length + 1 + w.length <= width) line += " " + w;
        else { out.push(line); line = w; }
      });
      out.push(line);
    });
    return out;
  }

  const display = (e) => {
    const t = TYPES[e.type];
    let text = e.text.replace(/\s+$/, "");
    if (t.upper) text = text.toUpperCase();
    if (e.type === "parenthetical" && text && !text.startsWith("(")) text = `(${text})`;
    return text;
  };

  /* ---------- Revisions: the industry's colour order ---------- */
  const REV_COLORS = [
    ["Blue", "#CFE3FF"], ["Pink", "#FFD6E5"], ["Yellow", "#FFF3A8"], ["Green", "#D4F2D0"], ["Goldenrod", "#F2D27A"],
    ["Buff", "#F1E3C6"], ["Salmon", "#FFC9B5"], ["Cherry", "#F7A8B0"],
    ["Double White", "#FFFFFF"], ["Double Blue", "#CFE3FF"], ["Double Pink", "#FFD6E5"], ["Double Yellow", "#FFF3A8"],
    ["Double Green", "#D4F2D0"], ["Double Goldenrod", "#F2D27A"],
  ];
  const revColor = (name) => (REV_COLORS.find(c => c[0] === name) || ["", "#FFFFFF"])[1];
  const revIndex = (script, id) => (script.revisions || []).findIndex(r => r.id === id);

  /* ---------- Dual dialogue: two speeches side by side (columns in characters) ---------- */
  const DUAL = {
    left:  { character: 8,  parenthetical: 3,  dialogue: 0 },
    right: { character: 39, parenthetical: 34, dialogue: 31 },
    width: { character: 22, parenthetical: 22, dialogue: 28 },
  };

  // Each element as printed lines: [{ text, indent, type, rev }]
  function linesOf(e, side = null) {
    const t = TYPES[e.type];
    const width = side ? DUAL.width[e.type] : t.width;
    return wrap(display(e), width).map(line => ({
      text: line, type: e.type, rev: e.rev || null,
      indent: side ? DUAL[side][e.type] : t.right ? Math.max(0, t.width - line.length) : t.indent,
    }));
  }

  // A speech starting at els[i]: the name, then its parentheticals and dialogue
  function speechAt(els, i) {
    let j = i + 1;
    while (j < els.length && SPEECH.has(els[j].type)) j++;
    return { items: els.slice(i, j), next: j };
  }

  /* Splits the script into pages of LINES_PER_PAGE lines, keeping scene
     headings and names with what follows and continuing long speeches.
     Every line knows its scene (sc: the heading's id) and revision (rev). */
  function paginate(script) {
    const els = script.elements.filter(e => e.text.trim());
    const pages = [];
    let page = [], used = 0;
    let sceneNo = 0, sceneId = null;
    const flush = () => { pages.push(page); page = []; used = 0; };
    const room = () => LINES_PER_PAGE - used;
    const put = (lines, before) => {
      if (used > 0) for (let i = 0; i < before; i++) { page.push({ text: "", indent: 0, sc: sceneId }); used++; }
      lines.forEach(l => { page.push({ ...l, sc: sceneId }); used++; });
    };
    const need = (lines, before) => (used > 0 ? before : 0) + lines;

    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      const t = TYPES[e.type];
      let lines = linesOf(e);
      if (e.type === "scene") { sceneNo++; sceneId = e.id; lines[0] = { ...lines[0], scene: script.sceneNumbers ? sceneNo : null }; }

      if (e.type === "character") {
        const first = speechAt(els, i);
        // Dual dialogue: the next speech is marked to sit beside this one
        const second = els[first.next]?.type === "character" && els[first.next].dual ? speechAt(els, first.next) : null;
        if (second) {
          const left = first.items.flatMap(x => linesOf(x, "left"));
          const right = second.items.flatMap(x => linesOf(x, "right"));
          const rows = Array.from({ length: Math.max(left.length, right.length) }, (_, r) => {
            const a = left[r], b = right[r];
            const leftText = a ? " ".repeat(a.indent) + a.text : "";
            const text = b ? leftText.padEnd(b.indent) + b.text : leftText;
            return { text, indent: 0, type: "dual", rev: a?.rev || b?.rev || null };
          });
          if (need(rows.length, t.before) > room() && used > 0) flush();
          put(rows, t.before);
          i = second.next - 1;
          continue;
        }
        i = first.next - 1;
        const all = first.items.flatMap(x => linesOf(x));
        if (need(all.length, t.before) <= room()) { put(all, t.before); continue; }
        // Split across pages with (MORE) / (CONT'D) if at least the name and two lines fit
        if (used > 0 && room() - t.before >= 4 && all.length > 3) {
          const fit = room() - t.before - 1;
          const top = all.slice(0, fit), rest = all.slice(fit);
          // Don't end the page on a parenthetical
          while (top.length > 2 && top[top.length - 1].type === "parenthetical") rest.unshift(top.pop());
          put(top, t.before);
          page.push({ text: "(MORE)", indent: TYPES.character.indent, sc: sceneId }); used++;
          flush();
          const name = display(e).replace(/\s*\(CONT'D\)$/, "");
          put([{ text: `${name} (CONT'D)`, indent: TYPES.character.indent, type: "character" }, ...rest], 0);
          continue;
        }
        if (used > 0) flush();
        put(all, t.before);
        continue;
      }

      if (e.type === "scene" || e.type === "shot") {
        // Keep with at least two lines of what follows
        const next = els[i + 1];
        const nextLines = next ? Math.min(2, linesOf(next).length) + (next.type === "character" ? 1 : 0) : 0;
        if (need(lines.length, t.before) + (next ? TYPES[next.type].before + nextLines : 0) > room() && used > 0) flush();
        put(lines, t.before);
        continue;
      }

      if (need(lines.length, t.before) <= room()) { put(lines, t.before); continue; }
      // Long action: split if at least two lines fit here and two go over
      const space = room() - (used > 0 ? t.before : 0);
      if (e.type === "action" && space >= 2 && lines.length - space >= 2) {
        put(lines.slice(0, space), t.before);
        flush();
        put(lines.slice(space), 0);
        continue;
      }
      flush();
      put(lines, t.before);
    }
    if (page.length) pages.push(page);
    return pages;
  }

  // Scene lengths in eighths of a page (the industry's unit), from the laid-out pages
  function sceneEighths(script, pages = paginate(script)) {
    const lines = new Map();
    pages.flat().forEach(l => { if (l.sc) lines.set(l.sc, (lines.get(l.sc) || 0) + 1); });
    const out = new Map();
    lines.forEach((n, id) => out.set(id, Math.max(1, Math.round(n / (LINES_PER_PAGE / 8)))));
    return out;
  }
  const eighthsLabel = (n) => {
    const whole = Math.floor(n / 8), rest = n % 8;
    return [whole || "", rest ? `${rest}/8` : ""].filter(Boolean).join(" ") || "0";
  };

  function pageNodes(script, pages, { titlePage = script.titlePage } = {}) {
    const marks = script.showRevisions !== false;
    const nodes = [];
    if (titlePage && script.title.trim()) {
      nodes.push(el("section", { class: "sp-page sp-title-page" },
        el("div", { class: "sp-title-block" },
          el("p", { class: "sp-title-text" }, script.title.toUpperCase()),
          el("p", {}, "Written by"),
          el("p", {}, script.author || Projects.me() || ""),
          script.basedOn && el("p", { class: "sp-based" }, script.basedOn)),
        el("div", { class: "sp-title-foot" },
          el("p", { class: "sp-contact" }, script.contact),
          el("p", { class: "sp-draft" }, [script.draftDate, ...(script.revisions || []).map(r => `${r.color} Revision ${r.date}`)].filter(Boolean).join("\n")))));
    }
    pages.forEach((lines, i) => {
      // The page's revision: the latest one with a change on it
      const revs = marks ? [...new Set(lines.map(l => l.rev).filter(Boolean))] : [];
      const latest = revs.map(id => (script.revisions || [])[revIndex(script, id)]).filter(Boolean)
        .sort((a, b) => revIndex(script, b.id) - revIndex(script, a.id))[0];
      const section = el("section", { class: `sp-page${latest ? " is-revised" : ""}` },
        latest && el("span", { class: "sp-rev-head" }, `${latest.color} Revision · ${latest.date}`),
        i > 0 && el("span", { class: "sp-page-no" }, `${i + 1}.`),
        el("div", { class: "sp-lines" }, lines.map(l => el("div", { class: `sp-line${l.type ? ` is-${l.type}` : ""}`, style: `padding-left:${l.indent}ch` },
          l.scene && el("span", { class: "sp-scene-no sp-scene-no-left" }, String(l.scene)),
          l.text || " ",
          l.scene && el("span", { class: "sp-scene-no sp-scene-no-right" }, String(l.scene)),
          marks && l.rev && el("span", { class: "sp-rev-mark", "aria-label": "Revised" }, "*")))));
      if (latest && script.tintPages) section.style.background = revColor(latest.color);
      nodes.push(section);
    });
    return nodes;
  }


  /* =========================================================
     DRAWING THE PAGE
     ========================================================= */

  function render() {
    const s = current();
    $("sp-script").replaceChildren(...(scripts.length
      ? scripts.map(x => el("option", { value: x.id }, x.title || "Untitled script"))
      : [el("option", { value: "" }, "No scripts yet")]));
    $("sp-script").value = s?.id || "";
    $("sp-claim").replaceChildren(s && window.ProjectShare?.claimButton ? ProjectShare.claimButton(s.id, s.title) : "");
    const body = $("sp-body");
    if (!s) {
      body.replaceChildren(el("p", { class: "media-empty" }, "No scripts yet. Start one with “+ New script”, or import a Fountain file."));
      $("sp-pages").textContent = "";
      return;
    }

    const typeButtons = el("div", { class: "tool-group sp-types", role: "group", "aria-label": "Element type" },
      Object.entries(TYPES).map(([id, t]) => el("button", { type: "button", class: "sp-type-btn", dataset: { type: id },
        title: `${t.name} (${/Mac/.test(navigator.platform) ? "⌘" : "Ctrl+"}${t.key})`,
        onmousedown: (e) => e.preventDefault(),
        onclick: () => { const e = s.elements.find(x => x.id === focusId); if (e) { setType(s, e, id); } } }, t.name)));

    const exportMenu = el("select", { class: "team-select", "aria-label": "Export" },
      el("option", { value: "" }, "Export…"), el("option", { value: "pdf" }, "PDF"),
      el("option", { value: "fdx" }, "Final Draft (.fdx)"), el("option", { value: "fountain" }, "Fountain (.fountain)"),
      el("option", { value: "breakdown-pdf" }, "Breakdown sheets (PDF)"), el("option", { value: "breakdown-csv" }, "Breakdown (CSV)"),
      el("option", { value: "schedule-pdf" }, "Shooting order (PDF)"),
      el("option", { value: "storyboard" }, "Make a storyboard (a shot per scene)"),
      el("option", { value: "paper-edit" }, "Make an A/V script (paper edit)"));
    exportMenu.addEventListener("change", () => { const v = exportMenu.value; exportMenu.value = ""; exportScript(s, v); });

    const check = (key, label) => {
      const box = el("input", { type: "checkbox", checked: !!s[key] });
      box.addEventListener("change", () => { s[key] = box.checked; save(); render(); });
      return el("label", { class: "tool-group" }, box, ` ${label}`);
    };

    const dualButton = el("button", { type: "button", class: "sp-type-btn sp-dual-btn", title: "Put this speech beside the one before it",
      onmousedown: (e) => e.preventDefault(),
      onclick: () => {
        const e = s.elements.find(x => x.id === focusId);
        if (!e || e.type !== "character") { setStatus("Click into the second character's name first, then Dual dialogue."); return; }
        e.dual = !e.dual;
        markRev(s, e);
        save({ soon: true });
        rerender(e.id, null);
      } }, "Dual dialogue");

    // Tag the selected words for the breakdown
    const tagMenu = el("select", { class: "team-select", "aria-label": "Tag the selected words for the breakdown",
      onmousedown: () => { lastSelection = selectionNow() || lastSelection; } },
      el("option", { value: "" }, "Tag selection as…"), BREAKDOWN.map(([id, name]) => el("option", { value: id }, name)));
    tagMenu.addEventListener("change", () => {
      const category = tagMenu.value;
      tagMenu.value = "";
      if (!category) return;
      const sel = lastSelection;
      if (!sel?.text) { setStatus("Select some words in the script first (e.g. a prop), then choose what they are."); return; }
      const sceneId = sceneOf(s, sel.elementId);
      if (!sceneId) { setStatus("That's before the first scene heading."); return; }
      addTag(s, sceneId, category, sel.text);
      setStatus(`Tagged “${sel.text}” as ${BREAKDOWN.find(b => b[0] === category)[1]}.`);
    });

    body.replaceChildren(
      el("div", { class: "sketch-nav sp-tools" },
        el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "View" },
          [["write", "Write"], ["pages", "Pages"], ["breakdown", "Breakdown"]].map(([id, name]) =>
            el("button", { type: "button", "aria-pressed": String(view === id), onclick: () => { view = id; render(); } }, name))),
        view === "write" && typeButtons,
        view === "write" && dualButton,
        view === "write" && tagMenu,
        check("sceneNumbers", "Scene numbers"),
        check("titlePage", "Title page"),
        exportMenu),
      revisionBar(s),
      titleDetails(s),
      el("div", { class: "sp-layout" },
        sceneNavigator(s),
        view === "write" ? editor(s) : view === "pages" ? el("div", { class: "sp-pages-view", id: "sp-pages-view" }) : breakdownView(s)));
    renderPages();
    updateTypeButtons();
  }

  function titleDetails(s) {
    const f = (key, label, { textarea = false, placeholder = "" } = {}) => {
      const i = textarea ? el("textarea", { rows: "3", placeholder }) : el("input", { placeholder });
      i.value = s[key] || "";
      i.addEventListener("input", () => { s[key] = i.value; save({ soon: true }); if (key === "title") { const o = $("sp-script").selectedOptions[0]; if (o) o.textContent = i.value || "Untitled script"; } });
      return el("label", { class: "wr-field" }, label, i);
    };
    const open = (() => { try { return localStorage.getItem("spTitleOpen") === "1"; } catch { return false; } })();
    const box = el("details", { class: "wr-details", open },
      el("summary", {}, "Title page and details"),
      el("div", { class: "wr-details-grid" },
        f("title", "Title"), f("author", "Written by", { placeholder: Projects.me() }),
        f("basedOn", "Based on (optional)", { placeholder: "Based on the article by…" }), f("draftDate", "Draft (date or colour)", { placeholder: "First draft, 9 October 2026" }),
        f("contact", "Contact (bottom left of the title page)", { textarea: true, placeholder: "Name\nEmail\nPhone" })),
      el("div", { class: "comment-actions" }, el("button", { type: "button", class: "comment-action", onclick: () => {
        if (!confirm(`Delete the script “${s.title || "Untitled"}”?`)) return;
        scripts.splice(scripts.indexOf(s), 1); save(); currentId = scripts[0]?.id || null; render();
      } }, "Delete script")));
    box.addEventListener("toggle", () => { try { localStorage.setItem("spTitleOpen", box.open ? "1" : "0"); } catch {} });
    return box;
  }

  /* ---------- Revisions bar ---------- */
  function revisionBar(s) {
    const active = s.revisions.find(r => r.id === s.activeRevision);
    const nextColor = REV_COLORS[s.revisions.length % REV_COLORS.length][0];
    const marked = s.elements.filter(e => e.rev).length;
    const box = (key, label, title) => {
      const input = el("input", { type: "checkbox", checked: key === "showRevisions" ? s[key] !== false : !!s[key] });
      input.addEventListener("change", () => { s[key] = input.checked; save(); render(); });
      return el("label", { class: "tool-group", title }, input, ` ${label}`);
    };
    const bar = el("div", { class: `sp-revbar${active ? " is-active" : ""}` },
      el("span", { class: "sp-rev-swatch", "aria-hidden": "true" }),
      active
        ? el("span", {}, el("strong", {}, `${active.color} revision`), ` (${active.date}): changes are marked with *`)
        : el("span", {}, s.revisions.length ? "Not marking changes." : "Revisions: once a script is shared or in production, mark changes in colour (Blue, Pink, Yellow…)."),
      el("span", { class: "comment-actions" },
        active
          ? el("button", { type: "button", class: "comment-action", onclick: () => { s.activeRevision = null; save(); render(); } }, "Stop marking")
          : el("button", { type: "button", class: "comment-action", onclick: () => {
              const date = new Date().toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
              const r = { id: newId("rv"), color: nextColor, date };
              s.revisions.push(r);
              s.activeRevision = r.id;
              save(); render();
              setStatus(`${nextColor} revision started: everything you change from now on is marked.`);
            } }, `Start ${nextColor} revision`),
        s.revisions.length > 0 && box("showRevisions", "Show marks"),
        s.revisions.length > 0 && box("tintPages", "Colour the revised pages", "On screen and in the PDF, like the coloured paper used on set"),
        marked > 0 && el("button", { type: "button", class: "comment-action", onclick: () => {
          if (!confirm(`Remove the revision marks from ${marked} element${marked === 1 ? "" : "s"}? (Do this when issuing a clean new draft.)`)) return;
          s.elements.forEach(e => { delete e.rev; });
          save(); render();
        } }, "Clear marks")));
    if (active) bar.style.setProperty("--rev", revColor(active.color));
    return bar;
  }

  /* ---------- Script breakdown ---------- */
  // Categories, with the colours breakdown sheets traditionally use
  const BREAKDOWN = [
    ["props", "Props", "#B58CE0"], ["wardrobe", "Wardrobe", "#7FC4E8"], ["makeup", "Makeup and hair", "#F5A9C8"],
    ["extras", "Extras", "#7ED48A"], ["vehicles", "Vehicles", "#F49AC2"], ["stunts", "Stunts", "#F5A35C"],
    ["sfx", "Special effects", "#6EA8FE"], ["sound", "Sound", "#C9A86A"], ["music", "Music", "#E6D25C"],
    ["animals", "Animals", "#A3D9A5"], ["setDressing", "Set dressing", "#D9B38C"], ["notes", "Notes", "#CFCFD6"],
  ];

  // The scene heading an element belongs to
  function sceneOf(s, elementId) {
    let scene = null;
    for (const e of s.elements) {
      if (e.type === "scene") scene = e.id;
      if (e.id === elementId) return scene;
    }
    return null;
  }

  function addTag(s, sceneId, category, name) {
    const clean = name.replace(/\s+/g, " ").trim().toUpperCase();
    if (!clean || s.breakdown.some(b => b.sceneId === sceneId && b.category === category && b.name === clean)) return;
    s.breakdown.push({ id: newId("bd"), sceneId, category, name: clean });
    save({ soon: true });
  }

  // Each scene: heading parts, length, cast, tags and suggestions
  function scenesOf(s) {
    const eighths = sceneEighths(s);
    const out = [];
    let cur = null;
    s.elements.forEach(e => {
      if (e.type === "scene") {
        const text = display(e);
        const m = text.match(/^(INT\.\/EXT\.|EXT\.\/INT\.|INT\.|EXT\.|I\/E\.?|EST\.)\s*(.*?)(?:\s+-\s+([^-]+))?$/);
        cur = { id: e.id, heading: text, ie: m?.[1] || "", place: (m?.[2] || text).trim(), time: (m?.[3] || "").trim(),
                eighths: eighths.get(e.id) || 0, cast: new Set(), caps: new Set(), n: out.length + 1 };
        out.push(cur);
        return;
      }
      if (!cur || !e.text.trim()) return;
      if (e.type === "character") cur.cast.add(baseName(e.text));
      if (e.type === "action") (e.text.match(/\b[A-Z][A-Z'’-]{2,}(?:\s+[A-Z][A-Z'’-]{2,})*\b/g) || []).forEach(w => cur.caps.add(w));
    });
    out.forEach(sc => {
      sc.tags = s.breakdown.filter(b => b.sceneId === sc.id);
      sc.suggest = [...sc.caps].filter(w => !sc.cast.has(w) && !s.breakdown.some(b => b.sceneId === sc.id && b.name === w)
        && ![...new Set(s.elements.filter(x => x.type === "character").map(x => baseName(x.text)))].includes(w));
    });
    return out;
  }

  let breakdownSort = "script";
  function sortedScenes(s) {
    const scenes = scenesOf(s);
    if (breakdownSort === "location") scenes.sort((a, b) => a.place.localeCompare(b.place) || a.ie.localeCompare(b.ie) || a.time.localeCompare(b.time) || a.n - b.n);
    if (breakdownSort === "time") scenes.sort((a, b) => a.time.localeCompare(b.time) || a.place.localeCompare(b.place) || a.n - b.n);
    if (breakdownSort === "ie") scenes.sort((a, b) => a.ie.localeCompare(b.ie) || a.place.localeCompare(b.place) || a.n - b.n);
    return scenes;
  }

  function breakdownView(s) {
    const scenes = sortedScenes(s);
    const sort = el("select", { class: "team-select", "aria-label": "Order" },
      [["script", "Script order"], ["location", "By location (shooting order)"], ["time", "By time of day"], ["ie", "Interiors, then exteriors"]].map(([v, t]) => el("option", { value: v }, t)));
    sort.value = breakdownSort;
    sort.addEventListener("change", () => { breakdownSort = sort.value; render(); });
    const total = scenes.reduce((n, sc) => n + sc.eighths, 0);
    if (!scenes.length) return el("div", { class: "sp-breakdown" }, el("p", { class: "media-empty" }, "Add scene headings to break the script down."));

    // Totals per location, for planning shoot days
    const byPlace = new Map();
    scenes.forEach(sc => byPlace.set(sc.place, (byPlace.get(sc.place) || 0) + sc.eighths));

    return el("div", { class: "sp-breakdown" },
      el("div", { class: "sketch-nav" }, el("label", { class: "tool-group" }, "Order", sort),
        el("span", { class: "media-muted" }, `${scenes.length} scenes · ${eighthsLabel(total)} pages · ${byPlace.size} locations`)),
      el("p", { class: "media-tip" }, "Tag props, wardrobe, extras and the rest: select words in the script and use “Tag selection as…”, add them here, or click a suggestion (words in CAPITALS in the action). Cast comes from who speaks. Lengths are in eighths of a page."),
      el("ol", { class: "sp-bd-list" }, scenes.map(sc => {
        const input = el("input", { placeholder: "Add an item", "aria-label": `Add to scene ${sc.n}` });
        const cat = el("select", { class: "team-select", "aria-label": "Category" }, BREAKDOWN.map(([id, name]) => el("option", { value: id }, name)));
        const add = () => { if (input.value.trim()) { addTag(s, sc.id, cat.value, input.value); render(); } };
        input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } });
        return el("li", { class: "sp-bd-scene" },
          el("div", { class: "sp-bd-head" },
            el("span", { class: "sp-bd-n" }, String(sc.n)),
            el("strong", {}, sc.heading),
            el("span", { class: "pk-count" }, `${eighthsLabel(sc.eighths)} pg`)),
          el("div", { class: "sp-bd-row" }, el("span", { class: "sp-bd-label" }, "Cast"),
            sc.cast.size ? [...sc.cast].map(n => el("span", { class: "sp-tag", style: "--tag:#F28B82" }, n)) : el("span", { class: "media-muted" }, "No one speaks")),
          BREAKDOWN.filter(([id]) => sc.tags.some(t => t.category === id)).map(([id, name, color]) => el("div", { class: "sp-bd-row" },
            el("span", { class: "sp-bd-label" }, name),
            sc.tags.filter(t => t.category === id).map(t => el("span", { class: "sp-tag", style: `--tag:${color}` }, t.name,
              el("button", { type: "button", class: "pk-chip-remove", "aria-label": `Remove ${t.name}`, onclick: () => { s.breakdown.splice(s.breakdown.indexOf(t), 1); save(); render(); } }, "×"))))),
          sc.suggest.length > 0 && el("div", { class: "sp-bd-row" }, el("span", { class: "sp-bd-label" }, "Suggestions"),
            sc.suggest.map(w => el("button", { type: "button", class: "team-chip team-chip--toggle pk-suggest", title: `Add as ${cat.selectedOptions[0]?.textContent || "Props"}`,
              onclick: () => { addTag(s, sc.id, cat.value, w); render(); } }, `+ ${w}`))),
          el("div", { class: "sp-bd-add" }, cat, input, el("button", { type: "button", class: "small-btn", onclick: add }, "Add")));
      })));
  }

  /* ---------- Connections: Storyboarder and A/V Script ---------- */

  // The scenes with what's in them
  function sceneBlocks(s) {
    const out = [];
    s.elements.filter(e => e.text.trim()).forEach(e => {
      if (e.type === "scene") { out.push({ heading: display(e), items: [] }); return; }
      if (!out.length) out.push({ heading: "", items: [] });
      out[out.length - 1].items.push(e);
    });
    return out;
  }

  // A storyboard with a shot for each scene: the heading and action as the action, the lines as dialogue
  function toStoryboard(s) {
    const boards = (() => { const v = Projects.getData("storyboards", []); return Array.isArray(v) ? v : []; })();
    const frames = sceneBlocks(s).map((sc, i) => {
      const action = sc.items.filter(e => e.type === "action").map(e => e.text.trim()).join(" ");
      const lines = [];
      sc.items.forEach((e, j) => { if (e.type === "dialogue") { const who = sc.items.slice(0, j).reverse().find(x => x.type === "character"); lines.push(`${who ? baseName(who.text) : ""}: ${e.text.trim()}`); } });
      return { id: newId("f"), strokes: [], texts: [], image: null, scene: String(i + 1), shot: "", move: "", duration: 3, transition: "Cut",
        action: [sc.heading, action].filter(Boolean).join("\n"), dialogue: lines.join("\n"), sound: "" };
    });
    const board = { id: newId("b"), name: `${s.title || "Script"} (storyboard)`, kind: "video", aspect: "16:9", fps: 24, created: Date.now(), updated: Date.now(), frames };
    boards.push(board);
    Projects.setData("storyboards", boards);
    $("sp-status").replaceChildren(`Made a storyboard with ${frames.length} shot${frames.length === 1 ? "" : "s"}. `, el("a", { href: `storyboarder.html#board=${board.id}` }, "Open it in the Storyboarder"));
  }

  // A paper edit: a section per scene, action as B-roll, dialogue as narration ("NAME: line")
  function toPaperEdit(s) {
    const edits = (() => { const v = Projects.getData("edits", []); return Array.isArray(v) ? v : []; })();
    const blocks = [];
    const block = (kind, text) => blocks.push({ id: newId("k"), kind, text, seconds: null });
    sceneBlocks(s).forEach(sc => {
      if (sc.heading) block("section", sc.heading);
      sc.items.forEach((e, j) => {
        if (e.type === "action" || e.type === "shot") block("broll", e.text.trim());
        if (e.type === "dialogue") {
          const who = sc.items.slice(0, j).reverse().find(x => x.type === "character");
          block("narration", `${who ? baseName(who.text) + ": " : ""}${e.text.trim()}`);
        }
      });
    });
    const edit = { id: newId("ed"), name: `${s.title || "Script"} (from the screenplay)`, created: Date.now(), updated: Date.now(), blocks };
    edits.push(edit);
    Projects.setData("edits", edits);
    try { localStorage.setItem(`textEditCurrent:${Projects.activeId()}`, edit.id); } catch {}
    $("sp-status").replaceChildren(`Made a paper edit with ${blocks.length} lines. `, el("a", { href: "av-script.html" }, "See it on the A/V Script page"),
      " or ", el("a", { href: "media-and-transcripts.html#edit" }, "in Text Edit"), ".");
  }

  function breakdownCSV(s) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Scene", "Heading", "Int/Ext", "Location", "Time", "Pages (eighths)", "Cast", ...BREAKDOWN.map(b => b[1])];
    const rows = sortedScenes(s).map(sc => [sc.n, sc.heading, sc.ie, sc.place, sc.time, eighthsLabel(sc.eighths), [...sc.cast].join("; "),
      ...BREAKDOWN.map(([id]) => sc.tags.filter(t => t.category === id).map(t => t.name).join("; "))]);
    return [head, ...rows].map(r => r.map(q).join(",")).join("\r\n");
  }

  function printBreakdown(s, kind) {
    const scenes = sortedScenes(s);
    const nodes = kind === "schedule"
      ? [el("section", { class: "sp-bd-print" },
          el("h1", {}, `${s.title || "Script"}: shooting order`),
          el("table", { class: "sp-bd-table" },
            el("thead", {}, el("tr", {}, ["Sc.", "I/E", "Location", "Time", "Pages", "Cast"].map(h => el("th", {}, h)))),
            el("tbody", {}, scenes.map(sc => el("tr", { class: `is-${(sc.time || "").toLowerCase().includes("night") ? "night" : "day"}` },
              el("td", {}, String(sc.n)), el("td", {}, sc.ie), el("td", {}, sc.place), el("td", {}, sc.time), el("td", {}, eighthsLabel(sc.eighths)), el("td", {}, [...sc.cast].join(", ")))))))]
      : scenes.map(sc => el("section", { class: "sp-bd-print sp-bd-sheet" },
          el("h1", {}, `Breakdown sheet · Scene ${sc.n}`),
          el("p", {}, el("strong", {}, sc.heading), ` · ${eighthsLabel(sc.eighths)} pages · ${s.title || ""}`),
          el("dl", {}, el("dt", {}, "Cast"), el("dd", {}, [...sc.cast].join(", ") || "—"),
            BREAKDOWN.map(([id, name]) => [el("dt", {}, name), el("dd", {}, sc.tags.filter(t => t.category === id).map(t => t.name).join(", ") || "—")]))));
    $("sp-print").replaceChildren(...nodes);
    const title = document.title;
    document.title = `${s.title || "Script"} – ${kind === "schedule" ? "shooting order" : "breakdown"}`;
    setTimeout(() => { window.print(); document.title = title; }, 60);
  }

  /* Scenes and characters, beside the script.
     (Not called "navigator": that name would hide the browser's own
     navigator, which the shortcut hints read to tell Macs apart.) */
  function sceneNavigator(s) {
    let n = 0;
    const scenes = s.elements.filter(e => e.type === "scene" && e.text.trim()).map(e => ({ e, n: ++n }));
    const counts = new Map();
    s.elements.forEach(e => {
      if (e.type !== "character" || !e.text.trim()) return;
      const name = baseName(e.text);
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return el("nav", { class: "sp-nav", "aria-label": "Scenes" },
      el("h3", {}, `Scenes (${scenes.length})`),
      scenes.length ? el("ol", { class: "sp-scene-list" }, scenes.map(({ e, n }) => el("li", {},
        el("button", { type: "button", class: "sp-scene-btn", onclick: () => { if (view !== "write") { view = "write"; render(); } focusEl(e.id, 0, true); } },
          el("span", { class: "sp-scene-n" }, String(n)), e.text.toUpperCase()))))
        : el("p", { class: "media-muted" }, "Scene headings appear here."),
      el("h3", {}, "Characters"),
      counts.size ? el("ul", { class: "sp-char-list" }, [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, c]) =>
        el("li", {}, name, el("span", { class: "media-muted" }, ` · ${c} speech${c === 1 ? "" : "es"}`))))
        : el("p", { class: "media-muted" }, "Characters appear here."));
  }

  const baseName = (t) => t.toUpperCase().replace(/\s*\((?:V\.O\.|O\.S\.|O\.C\.|CONT'D|CONT’D|[^)]*)\)\s*$/g, "").trim();

  function renderPages() {
    const s = current();
    if (!s) return;
    const pages = paginate(s);
    const n = pages.length;
    $("sp-pages").textContent = `${n} page${n === 1 ? "" : "s"} · about ${n} minute${n === 1 ? "" : "s"}`;
    const box = $("sp-pages-view");
    if (box) box.replaceChildren(...pageNodes(s, pages));
  }


  /* =========================================================
     THE EDITOR
     ========================================================= */

  const grow = (t) => { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; };

  function editor(s) {
    const box = el("div", { class: "sp-editor", role: "document", "aria-label": "Script" });
    box.append(...s.elements.map(e => elementRow(s, e)));
    requestAnimationFrame(() => box.querySelectorAll("textarea").forEach(grow));
    return el("div", { class: "sp-paper" }, box,
      el("p", { class: "media-muted sp-help" }, "Enter: next element · Shift+Enter: new line · Tab: change type or finish a name · ",
        /Mac/.test(navigator.platform) ? "⌘1–7" : "Ctrl+1–7", ": scene heading, action, character, parenthetical, dialogue, transition, shot"));
  }

  function elementRow(s, e) {
    const t = TYPES[e.type];
    const area = el("textarea", { class: `sp-el is-${e.type}`, rows: "1", spellcheck: "true", dataset: { id: e.id },
      "aria-label": t.name, placeholder: placeholderFor(e.type), style: `margin-left:${t.indent}ch;width:${t.width + 1}ch` });
    area.value = e.text;
    const hint = el("div", { class: "sp-hint", style: `margin-left:${t.indent}ch` });
    area.addEventListener("input", () => {
      if (t.upper) {
        const pos = area.selectionStart;
        if (area.value !== area.value.toUpperCase()) { area.value = area.value.toUpperCase(); area.setSelectionRange(pos, pos); }
      }
      // "(" typed into empty dialogue starts a parenthetical
      if (e.type === "dialogue" && area.value === "(") { e.text = "()"; setType(s, e, "parenthetical", 1); return; }
      e.text = area.value;
      markRev(s, e);
      grow(area);
      showHint(s, e, hint);
      save({ soon: true });
    });
    area.addEventListener("focus", () => { focusId = e.id; updateTypeButtons(); showHint(s, e, hint); });
    area.addEventListener("blur", () => { hint.textContent = ""; });
    area.addEventListener("keydown", (event) => onKey(event, s, e, area));
    const remember = () => { const sel = area.value.slice(area.selectionStart, area.selectionEnd).trim(); if (sel) lastSelection = { elementId: e.id, text: sel }; };
    area.addEventListener("select", remember);
    area.addEventListener("mouseup", remember);
    area.addEventListener("keyup", remember);
    const rev = e.rev && s.showRevisions !== false ? s.revisions.find(r => r.id === e.rev) : null;
    const row = el("div", { class: `sp-row is-${e.type}${rev ? " has-rev" : ""}${e.dual ? " is-dual" : ""}`, title: rev ? `${rev.color} revision, ${rev.date}` : null },
      area, hint, e.dual && el("span", { class: "sp-dual-badge", style: `margin-left:${t.indent}ch` }, "dual dialogue (beside the speech above)"));
    if (rev) row.style.setProperty("--rev", revColor(rev.color));
    return row;
  }

  // Marks an element as changed in the revision being made (if there is one)
  function markRev(s, e) { if (s.activeRevision && e) e.rev = s.activeRevision; }

  let lastSelection = null;   // { elementId, text } for tagging
  function selectionNow() {
    const a = document.activeElement;
    if (!a?.classList?.contains("sp-el")) return null;
    const text = a.value.slice(a.selectionStart, a.selectionEnd).trim();
    return text ? { elementId: a.dataset.id, text } : null;
  }

  const placeholderFor = (type) => ({
    scene: "INT. LOCATION - DAY", action: "What we see and hear.", character: "NAME", parenthetical: "(beat)",
    dialogue: "What they say.", transition: "CUT TO:", shot: "CLOSE ON",
  })[type];

  /* Suggestions: character names and locations already in the script */
  function suggestion(s, e) {
    const text = e.text.toUpperCase();
    if (e.type === "character" && text) {
      const names = [...new Set(s.elements.filter(x => x.type === "character" && x !== e && x.text.trim()).map(x => baseName(x.text)))];
      return names.find(n => n.startsWith(text) && n !== text) || null;
    }
    if (e.type === "scene") {
      if (!text) return null;   // empty: Tab changes the type instead
      if (/^(I|IN|INT?)$/.test(text)) return "INT. ";
      if (/^(E|EX|EXT?)$/.test(text)) return "EXT. ";
      const m = text.match(/^((?:INT\.\/EXT\.|INT\.|EXT\.|I\/E\.?)\s+)(.+)$/);
      if (m) {
        const places = [...new Set(s.elements.filter(x => x.type === "scene" && x !== e).map(x => x.text.toUpperCase().replace(/^(?:INT\.\/EXT\.|INT\.|EXT\.|I\/E\.?)\s+/, "")))];
        const hit = places.find(p => p.startsWith(m[2]) && p !== m[2]);
        if (hit) return m[1] + hit;
        if (!/ - /.test(m[2]) && m[2].length > 2 && / $/.test(text)) return null;
      }
    }
    return null;
  }
  function showHint(s, e, hint) {
    const sug = suggestion(s, e);
    hint.textContent = sug ? `Tab: ${sug}` : "";
  }

  function onKey(event, s, e, area) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && /^[1-7]$/.test(event.key)) {
      event.preventDefault();
      const type = Object.entries(TYPES).find(([, t]) => t.key === event.key)[0];
      setType(s, e, type, area.selectionStart);
      return;
    }
    const i = s.elements.indexOf(e);
    if (event.key === "Enter" && !event.shiftKey && !mod) {
      event.preventDefault();
      const before = area.value.slice(0, area.selectionStart);
      let after = area.value.slice(area.selectionEnd);
      if (e.type === "parenthetical" && after.trim() === ")") after = "";   // Enter inside "(…)" finishes it
      // Smart action: INT./EXT. → scene heading, "…TO:" → transition, short capitals → character
      if (e.type === "action" && !after.trim()) {
        const t = before.trim();
        if (/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(t)) { e.type = "scene"; e.text = t.toUpperCase(); }
        else if (/^[A-Z0-9 .'’-]+TO:$/.test(t)) { e.type = "transition"; }
        else if (t && t.length <= 30 && /^[A-Z][A-Z0-9 .'’()-]*$/.test(t) && !/[.!?]$/.test(t)) { e.type = "character"; }
      }
      // Empty element: Enter changes its type instead of adding a line
      if (!before.trim() && !after.trim() && e.type !== "action") {
        setType(s, e, e.type === "dialogue" || e.type === "parenthetical" ? "action" : e.type === "character" ? "action" : "action", 0);
        return;
      }
      e.text = before.replace(/\s+$/, "");
      if (e.type === "parenthetical" && e.text && !e.text.endsWith(")")) e.text += ")";
      const next = { id: newId("e"), type: TYPES[e.type].enter, text: after.replace(/^\s+/, "") };
      markRev(s, e);
      markRev(s, next);
      s.elements.splice(i + 1, 0, next);
      save({ soon: true });
      rerender(next.id, 0);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const sug = !event.shiftKey && suggestion(s, e);
      if (sug) {
        e.text = sug;
        area.value = sug;
        area.setSelectionRange(sug.length, sug.length);
        area.dispatchEvent(new Event("input"));
        return;
      }
      const order = TAB_ORDER;
      const at = order.indexOf(e.type);
      setType(s, e, order[(at + (event.shiftKey ? order.length - 1 : 1)) % order.length], area.selectionStart);
      return;
    }
    if (event.key === "Backspace" && area.selectionStart === 0 && area.selectionEnd === 0 && i > 0) {
      event.preventDefault();
      const prev = s.elements[i - 1];
      const pos = prev.text.length;
      prev.text += e.text;
      markRev(s, prev);
      s.elements.splice(i, 1);
      save({ soon: true });
      rerender(prev.id, pos);
      return;
    }
    if (event.key === "ArrowUp" && area.selectionStart === 0 && i > 0) {
      event.preventDefault();
      focusEl(s.elements[i - 1].id, Infinity);
      return;
    }
    if (event.key === "ArrowDown" && area.selectionEnd === area.value.length && i < s.elements.length - 1) {
      event.preventDefault();
      focusEl(s.elements[i + 1].id, 0);
    }
  }

  function setType(s, e, type, caret = null) {
    if (e.type === type) return;
    e.type = type;
    markRev(s, e);
    if (type !== "character") delete e.dual;
    if (TYPES[type].upper) e.text = e.text.toUpperCase();
    if (type === "parenthetical" && !e.text.trim()) e.text = "()";
    if (type === "parenthetical" && e.text && !e.text.startsWith("(")) e.text = `(${e.text})`;
    save({ soon: true });
    rerender(e.id, type === "parenthetical" && e.text === "()" ? 1 : caret);
  }

  // Redraws the editor and puts the cursor back
  function rerender(id, caret) {
    const s = current();
    const scroll = window.scrollY;
    const old = document.querySelector(".sp-editor");
    if (!old) { render(); return; }
    old.replaceWith(editor(s).querySelector(".sp-editor"));
    const fresh = document.querySelector(".sp-editor");
    fresh.querySelectorAll("textarea").forEach(grow);
    document.querySelector(".sp-nav")?.replaceWith(sceneNavigator(s));
    window.scrollTo(0, scroll);
    focusEl(id, caret);
  }

  function focusEl(id, caret = null, scroll = false) {
    const area = document.querySelector(`.sp-el[data-id="${id}"]`);
    if (!area) return;
    area.focus({ preventScroll: !scroll });
    if (scroll) area.scrollIntoView({ block: "center" });
    const pos = caret == null ? area.value.length : Math.min(caret, area.value.length);
    area.setSelectionRange(pos, pos);
    focusId = id;
    updateTypeButtons();
  }

  function updateTypeButtons() {
    const e = current()?.elements.find(x => x.id === focusId);
    document.querySelectorAll(".sp-type-btn").forEach(b => b.setAttribute("aria-pressed", String(!!e && b.dataset.type === e.type)));
  }


  /* =========================================================
     EXPORT AND IMPORT
     ========================================================= */

  const download = Cobbler.download;

  function exportScript(s, kind) {
    const name = slug(s.title || "script");
    if (kind === "pdf") {
      $("sp-print").replaceChildren(...pageNodes(s, paginate(s)));
      const title = document.title;
      document.title = s.title || "Script";
      setTimeout(() => { window.print(); document.title = title; }, 60);
    }
    if (kind === "fdx") download(toFDX(s), `${name}.fdx`, "application/xml");
    if (kind === "breakdown-csv") download(breakdownCSV(s), `${name}-breakdown.csv`, "text/csv");
    if (kind === "breakdown-pdf") printBreakdown(s, "sheets");
    if (kind === "storyboard") toStoryboard(s);
    if (kind === "paper-edit") toPaperEdit(s);
    if (kind === "schedule-pdf") printBreakdown(s, "schedule");
    if (kind === "fountain") download(toFountain(s), `${name}.fountain`, "text/plain");
  }
  window.addEventListener("afterprint", () => $("sp-print").replaceChildren());

  const xml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const FDX_TYPES = { scene: "Scene Heading", action: "Action", character: "Character", parenthetical: "Parenthetical", dialogue: "Dialogue", transition: "Transition", shot: "Shot" };

  function toFDX(s) {
    let n = 0;
    const els = s.elements.filter(e => e.text.trim());
    const para = (e) => {
      const num = e.type === "scene" && s.sceneNumbers ? ` Number="${++n}"` : "";
      return `    <Paragraph Type="${FDX_TYPES[e.type]}"${num}>\n      <Text>${xml(display(e))}</Text>\n    </Paragraph>`;
    };
    const out = [];
    for (let i = 0; i < els.length; i++) {
      const e = els[i];
      if (e.type === "character") {
        const first = speechAt(els, i);
        const second = els[first.next]?.type === "character" && els[first.next].dual ? speechAt(els, first.next) : null;
        if (second) {
          // Final Draft keeps both speeches inside one DualDialogue paragraph
          out.push(`    <Paragraph>\n      <DualDialogue>\n${[...first.items, ...second.items].map(para).join("\n")}\n      </DualDialogue>\n    </Paragraph>`);
          i = second.next - 1;
          continue;
        }
      }
      out.push(para(e));
    }
    const paras = out.join("\n");
    const tp = (text, align = "Center") => `      <Paragraph Alignment="${align}" Type="Text"><Text>${xml(text)}</Text></Paragraph>`;
    const titlePage = s.title ? [tp(s.title.toUpperCase()), tp(""), tp("Written by"), tp(""), tp(s.author || ""), s.basedOn && tp(s.basedOn),
      ...String(s.contact || "").split("\n").filter(Boolean).map(line => tp(line, "Left")), s.draftDate && tp(s.draftDate, "Right")].filter(Boolean).join("\n") : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras}
  </Content>
  <TitlePage>
    <Content>
${titlePage}
    </Content>
  </TitlePage>
</FinalDraft>
`;
  }

  function toFountain(s) {
    const head = [s.title && `Title: ${s.title}`, `Credit: Written by`, s.author && `Author: ${s.author}`, s.basedOn && `Source: ${s.basedOn}`,
      s.draftDate && `Draft date: ${s.draftDate}`, s.contact && `Contact:\n${s.contact.split("\n").map(l => `    ${l}`).join("\n")}`].filter(Boolean).join("\n");
    const out = [];
    let n = 0;
    s.elements.filter(e => e.text.trim()).forEach((e, i, all) => {
      const text = display(e);
      const prev = all[i - 1];
      const tight = SPEECH.has(e.type) && prev && (prev.type === "character" || SPEECH.has(prev.type));
      if (out.length && !tight) out.push("");
      if (e.type === "scene") {
        const num = s.sceneNumbers ? ` #${++n}#` : "";
        out.push(/^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(text) ? text + num : `.${text}${num}`);
      } else if (e.type === "character") out.push((/[a-z]/.test(text) || !SPEECH.has(all[i + 1]?.type) ? `@${text}` : text) + (e.dual ? " ^" : ""));
      else if (e.type === "transition") out.push(/TO:$/.test(text) ? text : `> ${text}`);
      else if (e.type === "shot") out.push(`!${text}`);
      else if (e.type === "action") out.push(/^[A-Z0-9 .'’()-]+$/.test(text) && text.length < 40 ? `!${text}` : text);
      else out.push(text);
    });
    return `${head}\n\n${out.join("\n")}\n`;
  }

  /* Fountain → elements (title page keys, scene headings, characters,
     dialogue, parentheticals, transitions; notes and boneyard dropped) */
  function fromFountain(text) {
    let body = text.replace(/\r/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\[\[[\s\S]*?\]\]/g, "");
    const meta = {};
    // Title page: "Key: value" lines at the very top, up to the first blank line
    const titleMatch = body.match(/^((?:[A-Za-z ]+:.*\n(?:(?: {3,}|\t).*\n)*)+)\n/);
    if (titleMatch && /^(Title|Credit|Author|Authors|Source|Draft date|Contact)\s*:/im.test(titleMatch[1])) {
      let key = null;
      titleMatch[1].split("\n").forEach(line => {
        const m = line.match(/^([A-Za-z ]+):\s*(.*)$/);
        if (m) { key = m[1].toLowerCase(); meta[key] = m[2].trim(); }
        else if (key && line.trim()) meta[key] = (meta[key] ? meta[key] + "\n" : "") + line.trim();
      });
      body = body.slice(titleMatch[0].length);
    }
    const elements = [];
    const add = (type, t) => elements.push({ id: newId("e"), type, text: t });
    body.split(/\n{2,}/).forEach(block => {
      const lines = block.split("\n").filter(l => l.trim() !== "" || false);
      if (!lines.length) return;
      const first = lines[0].trim();
      if (/^(#|=)/.test(first) && !/^#\d/.test(first)) return;           // sections and synopses
      if (/^\.[^.]/.test(first) || /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(first)) {
        add("scene", first.replace(/^\./, "").replace(/\s*#[^#]+#\s*$/, "").toUpperCase());
        if (lines.length > 1) add("action", lines.slice(1).join("\n"));
        return;
      }
      if (/^>.*<$/.test(first)) { add("action", lines.map(l => l.replace(/^>\s*|\s*<$/g, "")).join("\n")); return; }
      if (/^>/.test(first) || (/^[A-Z0-9 .'’-]+TO:$/.test(first) && lines.length === 1)) { add("transition", first.replace(/^>\s*/, "")); return; }
      if (/^!/.test(first)) { add("action", lines.join("\n").replace(/^!/, "")); return; }
      if (/^@/.test(first) && lines.length === 1) { add("character", first.slice(1)); return; }
      const isCharacter = lines.length > 1 && (/^@/.test(first) || (/^[A-Z][A-Z0-9 .'’-]*(\s*\(.*\))?\s*\^?$/.test(first) && /[A-Z]/.test(first)));
      if (isCharacter) {
        add("character", first.replace(/^@/, "").replace(/\s*\^$/, ""));
        if (/\^\s*$/.test(first)) elements[elements.length - 1].dual = true;
        let dialogue = [];
        lines.slice(1).forEach(l => {
          const t = l.trim();
          if (/^\(.*\)$/.test(t)) { if (dialogue.length) { add("dialogue", dialogue.join("\n")); dialogue = []; } add("parenthetical", t); }
          else dialogue.push(t.replace(/^~/, ""));
        });
        if (dialogue.length) add("dialogue", dialogue.join("\n"));
        return;
      }
      add("action", lines.map(l => l.replace(/^\s+/, "")).join("\n"));
    });
    return {
      title: (meta.title || "").replace(/[*_]/g, "").split("\n")[0], author: meta.author || meta.authors || "",
      basedOn: meta.source || "", draftDate: meta["draft date"] || "", contact: meta.contact || "", elements,
    };
  }


  /* =========================================================
     START-UP
     ========================================================= */

  function select(id) {
    currentId = id;
    try { localStorage.setItem(currentKey(), id); } catch {}
    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("sp-script").addEventListener("change", (event) => select(event.target.value));
    $("sp-new").addEventListener("click", () => {
      const title = prompt("Title:", "Untitled");
      if (title == null) return;
      const s = normalize({ id: newId("sp"), title: title.trim() || "Untitled", author: Projects.me(), sceneNumbers: false, titlePage: true,
        elements: [{ id: newId("e"), type: "scene", text: "" }], created: Date.now(), updated: Date.now() });
      scripts.push(s);
      save();
      view = "write";
      select(s.id);
      focusEl(s.elements[0].id, 0);
    });
    $("sp-import").addEventListener("click", () => $("sp-import-input").click());
    $("sp-import-input").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      const parsed = fromFountain(await file.text());
      if (!parsed.elements.length) { setStatus(`Couldn't find a script in ${file.name}.`); return; }
      const s = normalize({ id: newId("sp"), ...parsed, title: parsed.title || file.name.replace(/\.[^.]+$/, ""), sceneNumbers: false, titlePage: true, created: Date.now(), updated: Date.now() });
      scripts.push(s);
      save();
      select(s.id);
      setStatus(`Imported ${file.name}: ${s.elements.length} elements.`);
    });
    render();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    clearTimeout(saveTimer); saveTimer = 0;
    if (event.detail.reason === "switch") currentId = remembered();   // another project: its own open script
    loadData();
    render();
    event.detail.handled = true;
  });

  window.Screenplay = { paginate, wrap, toFDX, toFountain, fromFountain, current, scenesOf, sceneEighths, eighthsLabel, breakdownCSV, REV_COLORS };
})();
