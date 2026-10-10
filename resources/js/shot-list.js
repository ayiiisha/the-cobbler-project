/* =========================================================
   shot-list.js — the Shot List page
   ---------------------------------------------------------
   Shot lists for a film or video shoot: one list per shoot day
   (or per scene, or per location: whatever suits), each a table
   of shots to get. Tick shots off on set.

   Saved inside the active project:
     project.data.shotLists = [{
       id, name, date: "2026-10-20", callTime: "07:00", location, notes,
       created, updated,
       shots: [{
         id, scene, size, angle, move, lens, description,
         intExt: "INT" | "EXT" | "INT/EXT" | "", dayNight, seconds, minutes,
         gear, sound, notes, done,
         storyboardRef: { boardId, frameId } | null,   ← when added from a storyboard
       }, ...],
     }, ...]

   Shot numbers aren't stored: they're worked out from the order
   (12A, 12B… within scene 12; plain 1, 2, 3… when scenes aren't
   numbered), so moving a shot renumbers the rest.

   Views (the address bar remembers which one is open):
     shot-list.html                library of shot lists
     shot-list.html#list=s123      one list

   Shots can be added by hand, from a storyboard's frames, or one
   master shot per scene of a screenplay. Exports: CSV, a PDF to
   print for the set, and the project details document (report.js).

   Needs projects-core.js and doc-export.js (for the PDF).
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("shot-list.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const { el, $, newId, plural, download, csvField } = Cobbler;


  /* =========================================================
     SETTINGS: the choices in the table's drop-downs
     ========================================================= */

  const SIZES = ["", "Extreme wide", "Wide", "Full", "Medium wide", "Medium", "Medium close-up",
    "Close-up", "Extreme close-up", "Over the shoulder", "Point of view", "Two-shot", "Insert", "Aerial"];
  const ANGLES = ["", "Eye level", "High", "Low", "Dutch", "Overhead", "Worm's eye"];
  const MOVES = ["", "Static", "Pan left", "Pan right", "Tilt up", "Tilt down", "Zoom in", "Zoom out",
    "Push in", "Pull out", "Track / dolly", "Handheld", "Steadicam / gimbal", "Crane / jib", "Whip pan", "Drone"];
  const INT_EXT = ["", "INT", "EXT", "INT/EXT"];
  const DAY_NIGHT = ["", "Day", "Night", "Dawn", "Dusk"];

  // Short forms for the PDF and CSV, where the columns are narrow
  const SHORT = {
    "Extreme wide": "EWS", "Wide": "WS", "Full": "FS", "Medium wide": "MWS", "Medium": "MS", "Medium close-up": "MCU",
    "Close-up": "CU", "Extreme close-up": "ECU", "Over the shoulder": "OTS", "Point of view": "POV", "Two-shot": "2S",
    "Insert": "INS", "Aerial": "AER",
  };
  const short = (size) => SHORT[size] || size || "";

  // Columns of the table, in order. "width" is a CSS size for the input.
  const COLUMNS = [
    { key: "scene",       label: "Scene",            kind: "text",   width: "4.5rem", placeholder: "12" },
    { key: "size",        label: "Size",             kind: "select", options: SIZES },
    { key: "angle",       label: "Angle",            kind: "select", options: ANGLES },
    { key: "move",        label: "Movement",         kind: "select", options: MOVES },
    { key: "lens",        label: "Lens",             kind: "text",   width: "4.5rem", placeholder: "35mm" },
    { key: "description", label: "Subject & action", kind: "textarea" },
    { key: "intExt",      label: "Int/Ext",          kind: "select", options: INT_EXT },
    { key: "dayNight",    label: "Day/Night",        kind: "select", options: DAY_NIGHT },
    { key: "seconds",     label: "Secs",             kind: "number", width: "4rem", title: "How long the shot runs on screen, in seconds" },
    { key: "minutes",     label: "Mins",             kind: "number", width: "4rem", title: "How long it takes to shoot, in minutes" },
    { key: "gear",        label: "Gear",             kind: "text",   width: "8rem", placeholder: "Tripod, slider…" },
    { key: "sound",       label: "Sound",            kind: "text",   width: "7rem", placeholder: "Sync, MOS…" },
    { key: "notes",       label: "Notes",            kind: "textarea" },
  ];


  /* =========================================================
     SAVED DATA
     ========================================================= */

  let lists = [];
  function loadData() {
    lists = Projects.getData("shotLists", []);
    if (!Array.isArray(lists)) lists = [];
    lists.forEach(list => {
      for (const key of ["name", "date", "callTime", "location", "notes"]) list[key] ??= "";
      list.shots = Array.isArray(list.shots) ? list.shots : [];
      list.shots.forEach(fixShot);
    });
  }
  function fixShot(shot) {
    for (const col of COLUMNS) shot[col.key] ??= "";
    shot.done = !!shot.done;
    shot.storyboardRef ??= null;
  }
  loadData();

  let saveTimer = 0;
  function save({ soon = false } = {}) {
    clearTimeout(saveTimer);
    const write = () => Projects.setData("shotLists", lists);
    if (soon) saveTimer = setTimeout(write, 500); else write();
  }
  window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; Projects.setData("shotLists", lists); } });

  const touch = (list) => { list.updated = Date.now(); };

  const blankShot = (extra = {}) => {
    const shot = { id: newId("sh"), done: false, storyboardRef: null, ...extra };
    fixShot(shot);
    return shot;
  };


  /* =========================================================
     SHOT NUMBERS AND SUMS
     ========================================================= */

  // Numbers for every shot, in order: "12A", "12B"… within scene 12;
  // plain 1, 2, 3… for a list whose scenes aren't numbered
  function numbers(shots) {
    const numbered = shots.length > 0 && shots.every(s => /^\d+[A-Za-z]?$/.test(String(s.scene).trim()));
    if (!numbered) return shots.map((s, i) => String(i + 1));
    const seen = {};
    return shots.map(s => {
      const scene = String(s.scene).trim();
      const n = seen[scene] = (seen[scene] || 0) + 1;
      // A, B … Z, AA, AB … (the 27th shot of a scene is rare, but possible)
      let letters = "";
      for (let k = n - 1; k >= 0; k = Math.floor(k / 26) - 1) letters = String.fromCharCode(65 + (k % 26)) + letters;
      return scene + letters;
    });
  }

  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const totals = (shots) => ({
    shots: shots.length,
    done: shots.filter(s => s.done).length,
    seconds: shots.reduce((t, s) => t + num(s.seconds), 0),
    minutes: shots.reduce((t, s) => t + num(s.minutes), 0),
    scenes: new Set(shots.map(s => String(s.scene).trim()).filter(Boolean)).size,
  });
  const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
  const hours = (minutes) => minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ""}`.trim() : `${minutes} min`;

  // "2026-10-20" → "Tue 20 Oct 2026"
  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }

  // Scenes in order: 2 before 10, 10 before 10A; unnumbered scenes keep their place at the end
  function sceneOrder(a, b) {
    const parse = (v) => { const m = String(v).trim().match(/^(\d+)([A-Za-z]*)$/); return m ? [Number(m[1]), m[2].toUpperCase()] : null; };
    const pa = parse(a), pb = parse(b);
    if (pa && pb) return pa[0] - pb[0] || pa[1].localeCompare(pb[1]);
    if (pa) return -1;
    if (pb) return 1;
    return 0;   // (a stable sort keeps the rest as they were)
  }


  /* =========================================================
     ADDING SHOTS FROM ELSEWHERE IN THE PROJECT
     ========================================================= */

  // A storyboard frame's shot type is one of our sizes already (same vocabulary);
  // anything else is matched by keyword, so hand-typed values still land somewhere
  function sizeFrom(text) {
    const t = String(text || "").toLowerCase();
    if (!t) return "";
    if (SIZES.includes(text)) return text;
    // Abbreviations first (whole words: "ots dirty single", "ECU on the ring")
    const abbr = Object.entries(SHORT).find(([, code]) => new RegExp(`\\b${code.toLowerCase()}\\b`).test(t));
    if (abbr) return abbr[0];
    const rules = [["extreme close", "Extreme close-up"], ["medium close", "Medium close-up"], ["close", "Close-up"],
      ["extreme wide", "Extreme wide"], ["establishing", "Extreme wide"], ["medium wide", "Medium wide"], ["wide", "Wide"],
      ["medium", "Medium"], ["full", "Full"], ["over", "Over the shoulder"], ["pov", "Point of view"], ["point of view", "Point of view"],
      ["two", "Two-shot"], ["insert", "Insert"], ["aerial", "Aerial"], ["drone", "Aerial"]];
    return rules.find(([k]) => t.includes(k))?.[1] || "";
  }

  // Every frame of a storyboard becomes a shot
  function shotsFromStoryboard(board) {
    return (Array.isArray(board.frames) ? board.frames : []).map(f => blankShot({
      scene: f.scene || "", size: sizeFrom(f.shot), move: MOVES.includes(f.move) ? f.move : (f.move || ""),
      seconds: f.duration ?? "", description: [f.action, f.dialogue && `“${f.dialogue}”`].filter(Boolean).join("\n"),
      sound: f.sound || "", storyboardRef: { boardId: board.id, frameId: f.id },
    }));
  }

  // One master shot per scene heading of a screenplay ("INT. KITCHEN - NIGHT")
  function shotsFromScreenplay(script) {
    const headings = (Array.isArray(script.elements) ? script.elements : []).filter(e => e.type === "scene" && String(e.text || "").trim());
    return headings.map((e, i) => {
      const text = String(e.text).trim();
      const upper = text.toUpperCase();
      const intExt = upper.startsWith("INT./EXT") || upper.startsWith("INT/EXT") || upper.startsWith("I/E") ? "INT/EXT"
        : upper.startsWith("INT") ? "INT" : upper.startsWith("EXT") ? "EXT" : "";
      const dayNight = DAY_NIGHT.find(d => d && new RegExp(`[-–—]\\s*${d.toUpperCase()}\\b`).test(upper)) || "";
      return blankShot({ scene: String(i + 1), size: "Wide", intExt, dayNight, description: text });
    });
  }


  /* =========================================================
     ROUTING: library, or one list
     ========================================================= */

  let current = null;   // the open list

  function route() {
    const id = new URLSearchParams(location.hash.slice(1)).get("list");
    current = lists.find(l => l.id === id) || null;
    $("sl-library").hidden = !!current;
    $("sl-list").hidden = !current;
    if (current) renderList(); else renderLibrary();
  }

  function openList(list) {
    history.pushState(null, "", list ? `#list=${list.id}` : location.pathname);
    route();
  }
  window.addEventListener("hashchange", route);


  /* =========================================================
     THE LIBRARY
     ========================================================= */

  function renderLibrary() {
    const box = $("sl-cards");
    if (!lists.length) {
      box.replaceChildren(el("p", { class: "media-empty" }, "No shot lists yet. Make one for each shoot day (or scene, or location) and list the shots to get."));
      return;
    }
    const sorted = [...lists].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (b.updated || 0) - (a.updated || 0));
    box.replaceChildren(...sorted.map(list => {
      const t = totals(list.shots);
      return el("article", { class: `sl-card${t.shots && t.done === t.shots ? " is-complete" : ""}` },
        el("button", { type: "button", class: "sl-card-name", onclick: () => openList(list) }, list.name || "Untitled shot list"),
        el("p", { class: "sl-card-when" }, [list.date && formatDate(list.date), list.callTime && `call ${list.callTime}`, list.location].filter(Boolean).join(" · ") || "No date or location yet"),
        el("p", { class: "sl-card-sum" }, `${t.done}/${plural(t.shots, "shot")} done`,
          t.scenes ? ` · ${plural(t.scenes, "scene")}` : "", t.minutes ? ` · about ${hours(t.minutes)} to shoot` : ""),
        el("div", { class: "sl-card-actions" },
          el("button", { type: "button", class: "comment-action", onclick: () => openDetails(list) }, "Details"),
          el("button", { type: "button", class: "comment-action", onclick: () => duplicateList(list) }, "Duplicate"),
          el("button", { type: "button", class: "comment-action", onclick: () => removeList(list) }, "Delete")));
    }));
  }

  function duplicateList(list) {
    const copy = JSON.parse(JSON.stringify(list));
    copy.id = newId("sl");
    copy.name = `${list.name || "Shot list"} (copy)`;
    copy.created = copy.updated = Date.now();
    copy.shots.forEach(s => { s.id = newId("sh"); s.done = false; });
    lists.push(copy);
    save();
    renderLibrary();
  }

  function removeList(list) {
    if (!confirm(`Delete “${list.name || "this shot list"}” and its ${plural(list.shots.length, "shot")}?`)) return;
    lists = lists.filter(l => l !== list);
    save();
    if (current === list) openList(null); else renderLibrary();
  }


  /* =========================================================
     LIST DETAILS (dialog): name, date, call time, location, notes
     ========================================================= */

  let editing = null;   // the list whose details are open (null: a new one)

  function openDetails(list = null) {
    editing = list;
    const form = $("sl-form");
    form.reset();
    if (list) for (const key of ["name", "date", "callTime", "location", "notes"]) form.elements[key].value = list[key];
    $("sl-dialog-title").textContent = list ? "Shot list details" : "New shot list";
    $("sl-dialog").showModal();
    form.elements.name.focus();
  }

  function setUpDialog() {
    const dialog = $("sl-dialog");
    $("sl-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    $("sl-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const details = Object.fromEntries(["name", "date", "callTime", "location", "notes"].map(k => [k, String(data.get(k) || "").trim()]));
      if (editing) {
        Object.assign(editing, details);
        touch(editing);
        save();
        dialog.close();
        if (current === editing) renderList(); else renderLibrary();
      } else {
        const list = { id: newId("sl"), ...details, shots: [], created: Date.now(), updated: Date.now() };
        lists.push(list);
        save();
        dialog.close();
        openList(list);
      }
    });
  }


  /* =========================================================
     ONE LIST: the table of shots
     ========================================================= */

  let hideDone = false;
  let dragged = null;

  function renderList() {
    const list = current;
    const t = totals(list.shots);
    $("sl-title").textContent = list.name || "Untitled shot list";
    $("sl-when").textContent = [list.date && formatDate(list.date), list.callTime && `Call ${list.callTime}`, list.location].filter(Boolean).join(" · ");
    $("sl-notes").textContent = list.notes;
    $("sl-notes").hidden = !list.notes;
    $("sl-summary").replaceChildren(
      el("span", { class: "team-chip" }, `${t.done}/${plural(t.shots, "shot")} done`),
      t.scenes ? el("span", { class: "team-chip" }, plural(t.scenes, "scene")) : null,
      t.seconds ? el("span", { class: "team-chip", title: "Screen time, if every shot is used in full" }, `${clock(t.seconds)} on screen`) : null,
      t.minutes ? el("span", { class: "team-chip", title: "Shooting time, from the Mins column" }, `about ${hours(t.minutes)} to shoot`) : null);
    $("sl-hide-done").setAttribute("aria-pressed", String(hideDone));
    $("sl-hide-done").textContent = hideDone ? `Show done (${t.done})` : "Hide done";
    renderTable();
  }

  function renderTable() {
    const list = current;
    const labels = numbers(list.shots);
    const body = $("sl-body");
    const rows = list.shots.map((shot, i) => shotRow(shot, i, labels[i])).filter(Boolean);
    body.replaceChildren(...rows);
    $("sl-empty").hidden = list.shots.length > 0;
    $("sl-table-wrap").hidden = !rows.length;
    if (list.shots.length && !rows.length) $("sl-empty").hidden = false;
    $("sl-empty").textContent = list.shots.length
      ? "Every shot is done. “Show done” brings them back."
      : "No shots yet. Add one, or bring them in from a storyboard or the screenplay.";
  }

  // Shot numbers again, without redrawing the rows (so typing a scene number doesn't lose focus)
  function renumber() {
    const labels = numbers(current.shots);
    current.shots.forEach((shot, i) => {
      const cell = $("sl-body").querySelector(`tr[data-id="${shot.id}"] .sl-num`);
      if (cell) cell.textContent = labels[i];
    });
  }

  function shotRow(shot, i, label) {
    if (hideDone && shot.done) return null;
    const list = current;
    const change = () => { touch(list); save({ soon: true }); };

    const done = el("input", { type: "checkbox", checked: shot.done, "aria-label": `Shot ${label} done` });
    done.addEventListener("change", () => { shot.done = done.checked; touch(list); save(); renderList(); });

    const cells = COLUMNS.map(col => {
      let field;
      if (col.kind === "select") {
        field = el("select", { "aria-label": col.label }, col.options.map(o => el("option", { value: o }, o || "–")));
        if (!col.options.includes(shot[col.key])) field.append(el("option", { value: shot[col.key] }, shot[col.key]));   // a value from an import
        field.value = shot[col.key];
        field.addEventListener("change", () => { shot[col.key] = field.value; change(); });
      } else if (col.kind === "textarea") {
        field = el("textarea", { rows: 1, "aria-label": col.label, placeholder: col.placeholder || "" }, shot[col.key]);
        const grow = () => { field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`; };
        field.addEventListener("input", () => { shot[col.key] = field.value; grow(); change(); });
        requestAnimationFrame(grow);
      } else {
        field = el("input", { type: col.kind === "number" ? "number" : "text", min: col.kind === "number" ? "0" : null, step: col.kind === "number" ? "any" : null,
          value: shot[col.key], "aria-label": col.label, placeholder: col.placeholder || "", title: col.title || null });
        if (col.width) field.style.width = col.width;
        field.addEventListener("input", () => { shot[col.key] = field.value; change(); });
        if (col.key === "scene") field.addEventListener("input", renumber);   // the numbers depend on the scene
      }
      return el("td", { class: `sl-col-${col.key}` }, field);
    });

    const move = (delta) => {
      const j = i + delta;
      if (j < 0 || j >= list.shots.length) return;
      [list.shots[i], list.shots[j]] = [list.shots[j], list.shots[i]];
      touch(list); save(); renderTable();
    };
    const row = el("tr", { class: `sl-row${shot.done ? " is-done" : ""}`, dataset: { id: shot.id } },
      el("td", { class: "sl-col-done" }, done),
      el("th", { scope: "row", class: "sl-col-num" },
        el("span", { class: "ideas-drag", title: "Drag to reorder", "aria-hidden": "true" }, "⠿"),
        el("span", { class: "sl-num" }, label),
        shot.storyboardRef && el("a", { class: "sl-board-link", href: `storyboarder.html#board=${encodeURIComponent(shot.storyboardRef.boardId)}&frame=${encodeURIComponent(shot.storyboardRef.frameId)}`, title: "Open this shot's storyboard frame", "aria-label": `Storyboard frame for shot ${label}` }, "▦")),
      ...cells,
      el("td", { class: "sl-col-actions" },
        el("button", { type: "button", class: "comment-action", "aria-label": `Move shot ${label} up`, disabled: i === 0, onclick: () => move(-1) }, "↑"),
        el("button", { type: "button", class: "comment-action", "aria-label": `Move shot ${label} down`, disabled: i === list.shots.length - 1, onclick: () => move(1) }, "↓"),
        el("button", { type: "button", class: "comment-action", "aria-label": `Duplicate shot ${label}`, onclick: () => {
          const copy = blankShot({ ...JSON.parse(JSON.stringify(shot)), id: newId("sh"), done: false });
          list.shots.splice(i + 1, 0, copy);
          touch(list); save(); renderList();
        } }, "⧉"),
        el("button", { type: "button", class: "comment-action", "aria-label": `Delete shot ${label}`, onclick: () => {
          if (shot.description.trim() && !confirm(`Delete shot ${label}?`)) return;
          list.shots.splice(i, 1);
          touch(list); save(); renderList();
        } }, "×")));

    // Drag by ⠿ to reorder
    const handle = row.querySelector(".ideas-drag");
    handle.addEventListener("pointerdown", () => { row.draggable = true; });
    row.addEventListener("dragstart", (event) => {
      dragged = shot;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", label);
      row.classList.add("is-dragging");
    });
    row.addEventListener("dragend", () => { row.draggable = false; row.classList.remove("is-dragging"); dragged = null; });
    row.addEventListener("dragover", (event) => { if (dragged && dragged !== shot) { event.preventDefault(); row.classList.add("is-drop"); } });
    row.addEventListener("dragleave", () => row.classList.remove("is-drop"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("is-drop");
      if (!dragged || dragged === shot) return;
      const from = list.shots.indexOf(dragged);
      const to = list.shots.indexOf(shot);
      list.shots.splice(from, 1);
      list.shots.splice(to, 0, dragged);
      dragged = null;
      touch(list); save(); renderTable();
    });
    return row;
  }

  function addShot(extra = {}) {
    const list = current;
    const last = list.shots[list.shots.length - 1];
    // A new shot starts in the same scene and setting as the last one
    const shot = blankShot({ scene: last?.scene || "", intExt: last?.intExt || "", dayNight: last?.dayNight || "", ...extra });
    list.shots.push(shot);
    touch(list); save();
    if (hideDone && shot.done) hideDone = false;
    renderList();
    $("sl-body").querySelector(`tr[data-id="${shot.id}"] .sl-col-size select`)?.focus();
  }

  /* "Add from a storyboard" / "Add scenes from the screenplay": a small picker when there's more than one */
  function pickAndAdd(kind) {
    const sources = kind === "storyboard"
      ? (Projects.getData("storyboards", []) || []).filter(b => Array.isArray(b.frames) && b.frames.length)
      : (Projects.getData("screenplays", []) || []).filter(s => Array.isArray(s.elements) && s.elements.some(e => e.type === "scene" && String(e.text || "").trim()));
    const what = kind === "storyboard" ? "storyboard with frames" : "screenplay with scene headings";
    if (!sources.length) { alert(`This project has no ${what} yet (${kind === "storyboard" ? "Storyboarder" : "Screenplay"} page).`); return; }
    const make = kind === "storyboard" ? shotsFromStoryboard : shotsFromScreenplay;
    const add = (source) => {
      const shots = make(source);
      const list = current;
      // Frames already in the list (added before) aren't added twice
      const have = new Set(list.shots.map(s => s.storyboardRef && `${s.storyboardRef.boardId}/${s.storyboardRef.frameId}`).filter(Boolean));
      const fresh = shots.filter(s => !s.storyboardRef || !have.has(`${s.storyboardRef.boardId}/${s.storyboardRef.frameId}`));
      if (!fresh.length) { alert("Every frame of that storyboard is in this list already."); return; }
      list.shots.push(...fresh);
      touch(list); save(); renderList();
      CobblerSync?.toast?.(`${plural(fresh.length, "shot")} added from “${source.name || source.title || kind}”.`, [], { id: "sl-toast" });
    };
    if (sources.length === 1) { add(sources[0]); return; }
    const box = $("sl-pick");
    $("sl-pick-title").textContent = kind === "storyboard" ? "Which storyboard?" : "Which screenplay?";
    $("sl-pick-list").replaceChildren(...sources.map(s => el("li", {},
      el("button", { type: "button", class: "small-btn", onclick: () => { box.close(); add(s); } },
        `${s.name || s.title || "Untitled"} (${kind === "storyboard" ? plural(s.frames.length, "frame") : plural(s.elements.filter(e => e.type === "scene" && String(e.text || "").trim()).length, "scene")})`))));
    box.showModal();
  }


  /* =========================================================
     EXPORTS
     ========================================================= */

  const exportRows = (list) => {
    const labels = numbers(list.shots);
    return list.shots.map((s, i) => [labels[i], s.scene, short(s.size), s.angle, s.move, s.lens, s.description, s.intExt, s.dayNight,
      String(s.seconds ?? ""), String(s.minutes ?? ""), s.gear, s.sound, s.notes, s.done ? "Done" : ""]);
  };
  const EXPORT_HEAD = ["#", "Scene", "Size", "Angle", "Movement", "Lens", "Subject & action", "Int/Ext", "Day/Night", "Secs", "Mins", "Gear", "Sound", "Notes", "Done"];

  function csv(list) {
    return [EXPORT_HEAD, ...exportRows(list)].map(row => row.map(csvField).join(",")).join("\r\n");
  }

  function printList(list) {
    const t = totals(list.shots);
    const blocks = [
      { t: "title", text: `${list.name || "Shot list"}` },
      { t: "meta", text: [Projects.activeName(), list.date && formatDate(list.date), list.callTime && `Call ${list.callTime}`, list.location].filter(Boolean).join(" · ") },
      list.notes && { t: "p", text: list.notes },
      { t: "meta", text: [plural(t.shots, "shot"), t.scenes && plural(t.scenes, "scene"), t.seconds && `${clock(t.seconds)} on screen`, t.minutes && `about ${hours(t.minutes)} to shoot`].filter(Boolean).join(" · ") },
      { t: "table", head: ["☐", "#", "Sc", "Size", "Angle", "Move", "Lens", "Subject & action", "I/E", "D/N", "Secs", "Gear / sound", "Notes"],
        rows: exportRows(list).map(r => [r[14] ? "☑" : "☐", r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], [r[11], r[12]].filter(Boolean).join("\n"), r[13]]) },
    ].filter(Boolean);
    DocExport.print(blocks, { title: list.name || "Shot list" });
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    $("sl-new").addEventListener("click", () => openDetails(null));
    $("sl-back").addEventListener("click", () => openList(null));
    $("sl-details").addEventListener("click", () => openDetails(current));
    $("sl-add").addEventListener("click", () => addShot());
    $("sl-from-board").addEventListener("click", () => pickAndAdd("storyboard"));
    $("sl-from-script").addEventListener("click", () => pickAndAdd("screenplay"));
    $("sl-sort").addEventListener("click", () => {
      current.shots = current.shots.map((s, i) => [s, i]).sort((a, b) => sceneOrder(a[0].scene, b[0].scene) || a[1] - b[1]).map(([s]) => s);
      touch(current); save(); renderTable();
    });
    $("sl-hide-done").addEventListener("click", () => { hideDone = !hideDone; renderList(); });
    $("sl-csv").addEventListener("click", () => download(csv(current), `${Cobbler.slug(current.name, "shot-list")}.csv`, "text/csv"));
    $("sl-pdf").addEventListener("click", () => printList(current));
    $("sl-pick-cancel").addEventListener("click", () => $("sl-pick").close());
    $("sl-pick").addEventListener("click", (event) => { if (event.target === $("sl-pick")) $("sl-pick").close(); });
    $("sl-delete").addEventListener("click", () => removeList(current));
    route();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => { dragged = null; loadData(); route(); event.detail.handled = true; });

  // For the self-tests
  window.ShotList = { numbers, totals, csv, shotsFromStoryboard, shotsFromScreenplay, sceneOrder, sizeFrom };
})();
