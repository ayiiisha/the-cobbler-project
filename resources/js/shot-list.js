/* =========================================================
   shot-list.js — the Shot List page
   ---------------------------------------------------------
   Shot lists for a film or video shoot: one list per shoot day
   (or per scene, or per location: whatever suits), each a table
   of shots to get. Tick shots off on set.

   Saved inside the active project:
     project.data.shotLists = [{
       id, name, date: "2026-10-20", callTime: "07:00", wrapTime, location, notes,
       access, hospital, weather,          ← for the call sheet
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
   master shot per scene of a screenplay.

   Exports: CSV; a CSV laid out for scheduling apps (scene number
   and shot letter in their own columns, the headings StudioBinder
   and Shot Lister expect); a PDF of the list to print for the set;
   a calendar file (.ics) with the day's running order; a call sheet
   (PDF or Word) with the schedule, crew (Team page), cast and
   contributors (Interviews page), location, access, weather and
   the nearest hospital; and the project details document (report.js).

   Needs projects-core.js and doc-export.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("shot-list.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const { el, $, newId, plural, download, csvField, formatDate, formatTime, dragReorder } = Cobbler;


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

  const LIST_FIELDS = ["name", "date", "callTime", "wrapTime", "location", "notes", "access", "hospital", "weather"];

  let lists = [];
  function loadData() {
    lists = Projects.getData("shotLists", []);
    if (!Array.isArray(lists)) lists = [];
    lists.forEach(list => {
      for (const key of LIST_FIELDS) list[key] ??= "";
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
    if (id && !current) history.replaceState(null, "", location.pathname);
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
        el("p", { class: "sl-card-when" }, [list.date && formatDate(list.date, { weekday: true }), list.callTime && `call ${formatTime(list.callTime)}`, list.location].filter(Boolean).join(" · ") || "No date or location yet"),
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
    if (list) for (const key of LIST_FIELDS) form.elements[key].value = list[key];
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
      const details = Object.fromEntries(LIST_FIELDS.map(k => [k, String(data.get(k) || "").trim()]));
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
  const drag = { item: null };   // the shot being dragged (Cobbler.dragReorder)

  function renderList() {
    const list = current;
    const t = totals(list.shots);
    $("sl-title").textContent = list.name || "Untitled shot list";
    $("sl-when").textContent = [list.date && formatDate(list.date, { weekday: true }), list.callTime && `Call ${formatTime(list.callTime)}`, list.wrapTime && `wrap ${formatTime(list.wrapTime)}`, list.location].filter(Boolean).join(" · ");
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
      return el("td", { class: `sl-col-${col.key}`, dataset: { label: col.label } }, field);
    });

    const move = (delta) => {
      const j = i + delta;
      if (j < 0 || j >= list.shots.length) return;
      [list.shots[i], list.shots[j]] = [list.shots[j], list.shots[i]];
      touch(list); save(); renderTable();
    };
    const row = el("tr", { class: `sl-row${shot.done ? " is-done" : ""}`, dataset: { id: shot.id } },
      el("td", { class: "sl-col-done", dataset: { label: "Done" } }, done),
      el("th", { scope: "row", class: "sl-col-num" },
        el("span", { class: "ideas-drag", title: "Drag to reorder", "aria-hidden": "true" }, "⠿"),
        el("span", { class: "sl-num" }, label),
        shot.storyboardRef && el("a", { class: "sl-board-link", href: `storyboarder.html#board=${encodeURIComponent(shot.storyboardRef.boardId)}&frame=${encodeURIComponent(shot.storyboardRef.frameId)}`, title: "Open this shot's storyboard frame", "aria-label": `Storyboard frame for shot ${label}` }, "▦")),
      ...cells,
      el("td", { class: "sl-col-actions", dataset: { label: "Shot" } },
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

    // Drag by ⠿ to reorder (dropped on a row: the dragged shot takes its place)
    dragReorder(row, { handle: row.querySelector(".ideas-drag"), state: drag, item: shot, text: label, onDrop: (moved, onto) => {
      list.shots.splice(list.shots.indexOf(moved), 1);
      list.shots.splice(list.shots.indexOf(onto), 0, moved);
      touch(list); save(); renderTable();
    } });
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

  /* ---------- For scheduling apps (StudioBinder, Shot Lister and the like) ----------
     Scene number and shot letter in their own columns, one row per shot, sizes
     written out in full, with the column headings those apps' importers look for.
     (Their import screens still let you match columns if a heading differs.) */
  function schedulingCSV(list) {
    const labels = numbers(list.shots);
    const head = ["Scene", "Shot", "Shot Size", "Shot Type", "Movement", "Lens", "Description", "Subject", "INT/EXT", "Day/Night", "Est. Time (min)", "Screen Time (sec)", "Equipment", "Sound", "Notes", "Status"];
    const rows = list.shots.map((s, i) => {
      const label = labels[i];
      const scene = String(s.scene || "").trim();
      const letter = scene && label.startsWith(scene) ? label.slice(scene.length) : label;   // "12A" → "A"; unnumbered: "7"
      const firstLine = String(s.description || "").split("\n")[0];
      return [scene, letter, s.size, s.angle, s.move, s.lens, s.description, firstLine, s.intExt, s.dayNight, String(s.minutes ?? ""), String(s.seconds ?? ""), s.gear, s.sound, s.notes, s.done ? "Completed" : "Not shot"];
    });
    return [head, ...rows].map(row => row.map(csvField).join(",")).join("\r\n");
  }

  /* ---------- The day's running order: call time plus each shot's minutes ---------- */
  function runningOrder(list) {
    if (!list.callTime) return list.shots.map(() => "");
    let [h, m] = list.callTime.split(":").map(Number);
    let minutes = h * 60 + m;
    return list.shots.map(s => {
      const at = `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      minutes += num(s.minutes);
      return at;
    });
  }

  /* ---------- Calendar file (.ics): the shoot day, and a block per timed shot ---------- */
  function calendarFile(list) {
    const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const day = list.date.replace(/-/g, "");
    const labels = numbers(list.shots);
    const starts = runningOrder(list);
    const events = [];
    const [y, mo, d] = list.date.split("-").map(Number);
    const next = new Date(y, mo - 1, d + 1);
    const nextDay = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
    events.push(["BEGIN:VEVENT", `UID:shoot-${list.id}@cobbler-project`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${nextDay}`,
      `SUMMARY:${esc(`Shoot: ${list.name || "Shot list"}`)}`, list.location && `LOCATION:${esc(list.location)}`,
      `DESCRIPTION:${esc([list.callTime && `Call ${list.callTime}`, list.wrapTime && `Wrap ${list.wrapTime}`, plural(list.shots.length, "shot"), list.notes].filter(Boolean).join("\n"))}`,
      "END:VEVENT"].filter(Boolean).join("\r\n"));
    list.shots.forEach((s, i) => {
      if (!starts[i] || !num(s.minutes)) return;   // only shots with a time and a length get a block
      const [sh, sm] = starts[i].split(":").map(Number);
      const endMin = Math.min(sh * 60 + sm + num(s.minutes), 23 * 60 + 59);
      const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}${String(endMin % 60).padStart(2, "0")}00`;
      events.push(["BEGIN:VEVENT", `UID:shot-${s.id}@cobbler-project`, `DTSTAMP:${stamp}`,
        `DTSTART:${day}T${String(sh).padStart(2, "0")}${String(sm).padStart(2, "0")}00`, `DTEND:${day}T${end}`,
        `SUMMARY:${esc(`${labels[i]} ${short(s.size)}${s.description ? `: ${String(s.description).split("\n")[0]}` : ""}`)}`,
        list.location && `LOCATION:${esc(list.location)}`,
        `DESCRIPTION:${esc([[s.size, s.angle, s.move, s.lens].filter(Boolean).join(", "), s.description, s.gear && `Gear: ${s.gear}`, s.sound && `Sound: ${s.sound}`, s.notes].filter(Boolean).join("\n"))}`,
        "END:VEVENT"].filter(Boolean).join("\r\n"));
    });
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Cobbler Project//Shot List//EN", ...events, "END:VCALENDAR"].join("\r\n");
  }

  /* ---------- Call sheet: everything the crew needs for the day, on one page ---------- */
  function callSheetBlocks(list) {
    const labels = numbers(list.shots);
    const starts = runningOrder(list);
    const t = totals(list.shots);
    const team = (Projects.getData("team", []) || []).filter(p => p && p.name);
    const people = (Projects.getData("interviewees", []) || []).filter(p => p && p.name);
    // Contributors booked for this day; if the list has no date, everyone with a shoot date
    const cast = list.date ? people.filter(p => p.shootDate === list.date) : people.filter(p => p.shootDate);
    const contact = (p) => [p.phone, p.email, p.contact].filter(Boolean).join(" · ");
    const blocks = [
      { t: "title", text: `Call sheet: ${list.name || "Shoot"}` },
      { t: "meta", text: [Projects.activeName(), list.date && formatDate(list.date, { weekday: true })].filter(Boolean).join(" · ") },
      { t: "fields", items: [
        ["Call time", list.callTime ? formatTime(list.callTime) : "–"],
        ["Wrap (estimated)", list.wrapTime ? formatTime(list.wrapTime) : t.minutes && list.callTime ? `about ${formatTime(runningOrder({ ...list, shots: [...list.shots, { minutes: 0 }] }).at(-1))}` : "–"],
        ["Location", list.location || "–"],
        ["Access and parking", list.access || "–"],
        ["Weather", list.weather || "–"],
        ["Nearest hospital", list.hospital || "–"],
      ] },
      list.notes && { t: "h2", text: "Notes for the day" },
      list.notes && { t: "p", text: list.notes },
      { t: "h2", text: "Crew" },
      team.length
        ? { t: "table", head: ["Name", "Role", "Call", "Contact"], rows: team.map(p => [p.name, (Array.isArray(p.roles) ? p.roles : []).join(", "), list.callTime ? formatTime(list.callTime) : "", contact(p)]) }
        : { t: "p", text: "No one on the Team page yet. Add the crew there and they'll be listed here with their roles and contacts." },
      { t: "h2", text: "Cast and contributors" },
      cast.length
        ? { t: "table", head: ["Name", "Who", "Time", "Where", "Release", "Contact"], rows: cast.map(p => [p.name, p.role || "", p.shootTime ? formatTime(p.shootTime) : "", p.location || "", p.release?.status || "", p.contact || ""]) }
        : { t: "p", text: list.date ? `No one on the Interviews page has a shoot on ${formatDate(list.date)}.` : "Give the list a date to pull in the people booked for that day from the Interviews page." },
      { t: "h2", text: `Schedule (${plural(t.shots, "shot")}${t.minutes ? `, about ${hours(t.minutes)}` : ""})` },
      { t: "table", head: ["Time", "☐", "#", "Sc", "Size", "Subject & action", "I/E", "D/N", "Mins", "Gear / sound"],
        rows: list.shots.map((s, i) => [starts[i] ? formatTime(starts[i]) : "", s.done ? "☑" : "☐", labels[i], s.scene || "", short(s.size),
          [s.description, s.notes && `(${s.notes})`].filter(Boolean).join("\n"), s.intExt || "", s.dayNight || "", String(s.minutes || ""), [s.gear, s.sound].filter(Boolean).join(" / ")]) },
    ].filter(Boolean);
    return blocks;
  }

  function callSheet(list, format) {
    const name = `call-sheet-${Cobbler.slug(list.name, "shoot")}${list.date ? `-${list.date}` : ""}`;
    if (format === "docx") DocExport.downloadDocx(callSheetBlocks(list), { title: `Call sheet: ${list.name || "Shoot"}`, filename: `${name}.docx` });
    else DocExport.print(callSheetBlocks(list), { title: `Call sheet: ${list.name || "Shoot"}` });
  }

  function printList(list) {
    const t = totals(list.shots);
    const blocks = [
      { t: "title", text: `${list.name || "Shot list"}` },
      { t: "meta", text: [Projects.activeName(), list.date && formatDate(list.date, { weekday: true }), list.callTime && `Call ${formatTime(list.callTime)}`, list.location].filter(Boolean).join(" · ") },
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
    $("sl-csv-apps").addEventListener("click", () => download(schedulingCSV(current), `${Cobbler.slug(current.name, "shot-list")}-for-scheduling.csv`, "text/csv"));
    $("sl-pdf").addEventListener("click", () => printList(current));
    $("sl-ics").addEventListener("click", () => {
      if (!current.date) { alert("Give the list a shoot date first (Details)."); return; }
      download(calendarFile(current), `${Cobbler.slug(current.name, "shoot")}-${current.date}.ics`, "text/calendar");
    });
    $("sl-call-pdf").addEventListener("click", () => callSheet(current, "pdf"));
    $("sl-call-docx").addEventListener("click", () => callSheet(current, "docx"));
    $("sl-pick-cancel").addEventListener("click", () => $("sl-pick").close());
    $("sl-pick").addEventListener("click", (event) => { if (event.target === $("sl-pick")) $("sl-pick").close(); });
    $("sl-delete").addEventListener("click", () => removeList(current));
    route();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => { drag.item = null; loadData(); route(); event.detail.handled = true; });

  // For the self-tests
  window.ShotList = { numbers, totals, csv, schedulingCSV, runningOrder, calendarFile, callSheetBlocks, shotsFromStoryboard, shotsFromScreenplay, sceneOrder, sizeFrom };
})();
