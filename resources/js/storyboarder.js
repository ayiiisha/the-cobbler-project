/* =========================================================
   storyboarder.js — the Storyboarder page
   ---------------------------------------------------------
   Plan a video or animation shot by shot. Storyboards live
   inside the active project, under the key "storyboards":

     project.data.storyboards = [{
       id, name, kind: "video" | "animation", aspect: "16:9", fps: 24,
       created, updated,
       frames: [{
         id, strokes: [...], texts: [...],     ← drawing (sketch-core.js)
         image,                                ← optional photo behind the drawing (FileStore id)
         scene, shot, move, duration, transition,
         action, dialogue, sound,
       }, ...],
     }, ...]

   Views (the address bar remembers which one is open):
     storyboarder.html                         library of storyboards
     storyboarder.html#board=b123              the board: every shot as a panel
     storyboarder.html#board=b123&frame=f456   draw one shot, full size

   Plus an animatic player (plays the shots for their durations)
   and a print layout.

   A frame can link to a block in a paper edit (Media & Transcripts
   › Text Edit): frame.blockRef = { editId, blockId }. Linked frames
   show up beside that block on the A/V Script page. The frame editor
   also draws a framing guide for the chosen shot size (a figure
   outline for close-up, medium, wide…).

   Needs projects-core.js, file-store.js and sketch-core.js
   (and media-core.js for links to edit blocks).
   ========================================================= */
(() => {

  /* ---------- Safety check ---------- */
  if (!window.Projects || !window.Sketch) {
    console.error("storyboarder.js: load projects-core.js and sketch-core.js first.");
    return;
  }

  const { el } = window.Sketch;
  const $ = (id) => document.getElementById(id);


  /* =========================================================
     SETTINGS
     ========================================================= */

  const DATA_KEY = "storyboards";
  const VIEW_KEY = "storyboardView";   // remembers "Show notes" and guides (this browser)

  /* Frame shapes, width : height */
  const ASPECTS = {
    "16:9":   { name: "16:9 Widescreen",     note: "YouTube, TV, most video", ratio: 16 / 9 },
    "2.39:1": { name: "2.39:1 Scope",        note: "Wide cinema",             ratio: 2.39 },
    "1.85:1": { name: "1.85:1 Flat",         note: "Cinema",                  ratio: 1.85 },
    "4:3":    { name: "4:3 Classic",         note: "Old TV, retro looks",     ratio: 4 / 3 },
    "1:1":    { name: "1:1 Square",          note: "Social posts",            ratio: 1 },
    "4:5":    { name: "4:5 Portrait",        note: "Instagram feed",          ratio: 4 / 5 },
    "9:16":   { name: "9:16 Vertical",       note: "Reels, TikTok, Shorts",   ratio: 9 / 16 },
  };

  const KINDS = {
    video:     { name: "Video",     note: "Live action: shoots, interviews, music videos" },
    animation: { name: "Animation", note: "Timing shown in frames as well as seconds" },
  };

  const FRAME_RATES = [12, 24, 25, 30];

  const SHOT_TYPES = [
    "", "Extreme wide", "Wide", "Full", "Medium wide", "Medium", "Medium close-up",
    "Close-up", "Extreme close-up", "Over the shoulder", "Point of view", "Two-shot", "Insert", "Aerial",
  ];
  const MOVES = [
    "", "Static", "Pan left", "Pan right", "Tilt up", "Tilt down", "Zoom in", "Zoom out",
    "Push in", "Pull out", "Track / dolly", "Handheld", "Crane / jib", "Whip pan",
  ];
  const TRANSITIONS = ["Cut", "Dissolve", "Fade to black", "Wipe", "Match cut", "Smash cut"];

  /* The notes on each shot. Used for the panels, the frame editor and printing. */
  const FIELDS = [
    { key: "scene",      label: "Scene",           type: "text",     placeholder: "1" },
    { key: "duration",   label: "Seconds",         type: "number" },
    { key: "shot",       label: "Shot",            type: "select",   options: SHOT_TYPES },
    { key: "move",       label: "Camera",          type: "select",   options: MOVES },
    { key: "transition", label: "Then",            type: "select",   options: TRANSITIONS },
    { key: "action",     label: "Action",          type: "textarea", placeholder: "What happens on screen" },
    { key: "dialogue",   label: "Dialogue",        type: "textarea", placeholder: "Lines, voice-over" },
    { key: "sound",      label: "Sound & music",   type: "textarea", placeholder: "Effects, music cues" },
  ];


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const newId = Cobbler.newId;
  const plural = Cobbler.plural;
  const formatDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  // 83.5 → "1:23.5", 24 → "0:24"
  function formatTime(seconds) {
    const total = Math.max(0, seconds);
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    const whole = Math.floor(s);
    const tenth = Math.round((s - whole) * 10);
    return `${m}:${String(whole).padStart(2, "0")}${tenth ? "." + tenth : ""}`;
  }

  const ratioOf = (board) => (ASPECTS[board.aspect] || ASPECTS["16:9"]).ratio;
  const durationOf = (frame) => Math.max(0.1, Number(frame.duration) || 0);
  const runtimeOf = (board) => board.frames.reduce((sum, f) => sum + durationOf(f), 0);

  // "3s" or, for animation, "3s · 72 frames"
  function durationLabel(board, seconds) {
    const text = formatTime(seconds);
    return board.kind === "animation" ? `${text} · ${Math.round(seconds * board.fps)} frames` : text;
  }

  function blankFrame(previous) {
    return {
      id: newId("f"), strokes: [], texts: [], image: null,
      scene: previous?.scene || "1", shot: "", move: "", duration: 3, transition: "Cut",
      action: "", dialogue: "", sound: "",
    };
  }

  function loadView() {
    const fallback = { notes: true, guides: false, thirds: false, framing: true };
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(VIEW_KEY)) }; }
    catch { return fallback; }
  }
  const view = loadView();
  const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {} };


  /* =========================================================
     SAVED DATA
     ========================================================= */

  let boards = [];
  function loadData() {
    boards = Projects.getData(DATA_KEY, []);
    if (!Array.isArray(boards)) boards = [];
    // Fill in anything missing (e.g. from an older or hand-edited backup)
    boards.forEach(b => {
      if (!ASPECTS[b.aspect]) b.aspect = "16:9";
      if (!KINDS[b.kind]) b.kind = "video";
      b.fps = FRAME_RATES.includes(b.fps) ? b.fps : 24;
      b.frames = Array.isArray(b.frames) && b.frames.length ? b.frames : [blankFrame()];
      b.frames.forEach(f => {
        const fresh = blankFrame();
        for (const key of Object.keys(fresh)) if (f[key] === undefined) f[key] = fresh[key];
      });
    });
  }
  loadData();

  let saveTimer = 0;

  /* Saves everything. Pass the board that changed to update its "edited" time. */
  function save(board) {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (board) board.updated = Date.now();
    Projects.setData(DATA_KEY, boards);
  }

  // For typing in notes: wait for a pause before saving
  function saveSoon(board) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(board), 500);
  }
  window.addEventListener("pagehide", () => { if (saveTimer) save(); });

  /* Deletes stored images no storyboard in any project uses any more */
  async function releaseImages(ids) {
    const used = new Set(Projects.collect(DATA_KEY).flat()
      .flatMap(b => (b?.frames || []).map(f => f.image)).filter(Boolean));
    for (const id of ids) {
      if (id && !used.has(id)) await FileStore.remove(id).catch(() => {});
    }
  }


  /* =========================================================
     ROUTING
     ========================================================= */

  let editor = null;   // the drawing editor while a frame is open

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const board = boards.find(b => b.id === params.get("board")) || null;
    const frame = board?.frames.find(f => f.id === params.get("frame")) || null;
    return { board, frame };
  }

  function go({ board = null, frame = null } = {}, { replace = false } = {}) {
    let hash = "";
    if (board) hash = `#board=${encodeURIComponent(board.id)}` + (frame ? `&frame=${encodeURIComponent(frame.id)}` : "");
    if (replace) { history.replaceState(null, "", hash || location.pathname); route(); }
    else if (location.hash !== hash) location.hash = hash || "#";   // "hashchange" then calls route()
    else route();
  }

  function route() {
    const { board, frame } = readHash();
    editor?.destroy();
    editor = null;
    $("sb-library").hidden = !!board;
    $("sb-board").hidden = !board || !!frame;
    $("sb-frame").hidden = !frame;

    if (frame) showFrame(board, frame);
    else if (board) showBoard(board);
    else showLibrary();
  }


  /* =========================================================
     1. LIBRARY
     ========================================================= */

  function showLibrary() {
    document.title = "Storyboarder";
    const grid = $("sb-grid");
    grid.replaceChildren();

    if (!boards.length) {
      grid.append(el("p", { class: "sb-empty" },
        `No storyboards in “${Projects.activeName()}” yet. Start one with New storyboard.`));
      return;
    }

    [...boards].sort((a, b) => b.updated - a.updated).forEach(board => {
      const first = board.frames[0];
      grid.append(el("article", { class: "sb-card" },
        el("button", { type: "button", class: "sb-card-cover", "aria-label": `Open ${board.name}`, onclick: () => go({ board }) },
          Sketch.preview(first, ratioOf(board), { image: first.image })),
        el("div", { class: "sb-card-body" },
          el("h3", {}, board.name),
          el("p", { class: "sb-card-meta" }, `${KINDS[board.kind].name} · ${board.aspect}` + (board.kind === "animation" ? ` · ${board.fps} fps` : "")),
          el("p", { class: "sb-card-meta" }, `${plural(board.frames.length, "shot")} · ${formatTime(runtimeOf(board))}`),
          el("p", { class: "sb-card-meta" }, `Edited ${formatDate(board.updated)}`),
          el("div", { class: "sb-card-actions" },
            el("button", { type: "button", class: "small-btn", onclick: () => go({ board }) }, "Open"),
            el("button", { type: "button", class: "small-btn", onclick: () => openDialog(board) }, "Edit"),
            el("button", { type: "button", class: "small-btn", onclick: () => duplicateBoard(board) }, "Duplicate"),
            el("button", { type: "button", class: "small-btn", onclick: () => deleteBoard(board) }, "Delete")))));
    });
  }

  function duplicateBoard(board) {
    const copy = JSON.parse(JSON.stringify(board));   // images share the stored originals
    copy.id = newId("b");
    copy.name = `${board.name} (copy)`;
    copy.created = copy.updated = Date.now();
    copy.frames.forEach(f => { f.id = newId("f"); });
    boards.push(copy);
    save();
    showLibrary();
  }

  async function deleteBoard(board) {
    if (!confirm(`Delete “${board.name}” and all ${plural(board.frames.length, "shot")}? This can't be undone.`)) return;
    boards.splice(boards.indexOf(board), 1);
    save();
    go({}, { replace: true });
    await releaseImages(board.frames.map(f => f.image));
  }


  /* ---------- New / edit storyboard dialog ---------- */

  let editingBoard = null;

  function openDialog(board = null) {
    editingBoard = board;
    const form = $("sb-form");
    form.reset();
    form.elements.name.value = board?.name || "";
    form.elements.kind.value = board?.kind || "video";
    form.elements.aspect.value = board?.aspect || "16:9";
    form.elements.fps.value = String(board?.fps || 24);
    $("sb-dialog-title").textContent = board ? "Edit storyboard" : "New storyboard";
    $("sb-submit").textContent = board ? "Save changes" : "Create storyboard";
    $("sb-shots-field").hidden = !!board;
    updateDialog();
    $("sb-dialog").showModal();
    form.elements.name.focus();
  }

  function updateDialog() {
    const form = $("sb-form");
    $("sb-fps-field").hidden = form.elements.kind.value !== "animation";
    const changed = editingBoard && editingBoard.aspect !== form.elements.aspect.value;
    $("sb-dialog-note").textContent = changed ? "Drawings stretch to fit the new frame shape." : "";
  }

  function setUpDialog() {
    const dialog = $("sb-dialog");
    const form = $("sb-form");

    $("sb-kind-options").append(...Object.entries(KINDS).map(([id, k]) =>
      el("label", { class: "zine-preset" },
        el("input", { type: "radio", name: "kind", value: id }),
        el("span", { class: "zine-preset-name" }, k.name),
        el("span", { class: "zine-preset-note" }, k.note))));

    form.elements.aspect.append(...Object.entries(ASPECTS).map(([id, a]) =>
      el("option", { value: id }, `${a.name} (${a.note})`)));
    form.elements.fps.append(...FRAME_RATES.map(n => el("option", { value: String(n) }, `${n} fps`)));

    form.addEventListener("change", updateDialog);
    $("sb-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const fields = {
        name: String(data.get("name")).trim() || "Untitled storyboard",
        kind: data.get("kind") === "animation" ? "animation" : "video",
        aspect: ASPECTS[data.get("aspect")] ? String(data.get("aspect")) : "16:9",
        fps: FRAME_RATES.includes(Number(data.get("fps"))) ? Number(data.get("fps")) : 24,
      };

      if (editingBoard) {
        Object.assign(editingBoard, fields);
        save(editingBoard);
        dialog.close();
        route();
        return;
      }

      const shots = Math.min(60, Math.max(1, Math.round(Number(data.get("shots")) || 6)));
      const frames = [];
      for (let i = 0; i < shots; i++) frames.push(blankFrame(frames[i - 1]));
      const board = { id: newId("b"), ...fields, created: Date.now(), updated: Date.now(), frames };
      boards.push(board);
      save();
      dialog.close();
      go({ board });
    });
  }


  /* =========================================================
     FIELDS (shot notes), shared by panels and the frame editor
     ========================================================= */

  /* Builds the inputs for a shot's notes. `keys` picks which ones. */
  function fieldInputs(board, frame, keys, { onChange } = {}) {
    return FIELDS.filter(f => keys.includes(f.key)).map(field => {
      let input;
      if (field.type === "select") {
        input = el("select", {}, field.options.map(o => el("option", { value: o }, o || "—")));
      } else if (field.type === "textarea") {
        input = el("textarea", { rows: "2", placeholder: field.placeholder });
      } else if (field.type === "number") {
        input = el("input", { type: "number", min: "0.1", max: "600", step: "0.5", inputmode: "decimal" });
      } else {
        input = el("input", { type: "text", maxlength: "40", placeholder: field.placeholder });
      }
      input.value = frame[field.key] ?? "";

      input.addEventListener("input", () => {
        frame[field.key] = field.type === "number" ? Math.max(0.1, Number(input.value) || 0.1) : input.value;
        saveSoon(board);
        onChange?.(field.key);
      });
      input.addEventListener("change", () => save(board));

      return el("label", { class: `sb-field sb-field--${field.type}`, dataset: { key: field.key } }, field.label, input);
    });
  }


  /* =========================================================
     2. THE BOARD (every shot as a panel)
     ========================================================= */

  let dragged = null;      // the frame being dragged to a new position
  let scrollToId = null;   // shot to scroll to when the board next opens

  function showBoard(board) {
    document.title = `${board.name} · Storyboarder`;
    $("sb-board-title").textContent = board.name;
    $("sb-show-notes").checked = view.notes;
    updateBoardMeta(board);
    renderPanels(board, scrollToId);
    scrollToId = null;
  }

  function updateBoardMeta(board) {
    const parts = [KINDS[board.kind].name, ASPECTS[board.aspect].name];
    if (board.kind === "animation") parts.push(`${board.fps} fps`);
    parts.push(plural(board.frames.length, "shot"), `runs ${durationLabel(board, runtimeOf(board))}`);
    $("sb-board-meta").textContent = parts.join(" · ");
  }

  function renderPanels(board, focusId) {
    const grid = $("sb-panels");
    grid.classList.toggle("hide-notes", !view.notes);
    grid.style.setProperty("--ratio", ratioOf(board));
    grid.replaceChildren(...board.frames.map((frame, i) => panel(board, frame, i)),
      el("button", { type: "button", class: "sb-add-tile", onclick: () => insertFrame(board, board.frames.length) }, "+ Add shot"));
    if (focusId) grid.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function panel(board, frame, i) {
    const count = board.frames.length;
    const time = el("span", { class: "sb-panel-time" }, durationLabel(board, durationOf(frame)));

    const card = el("article", { class: "sb-panel", dataset: { id: frame.id } },
      el("div", { class: "sb-panel-head" },
        el("span", { class: "sb-drag", title: "Drag to reorder", "aria-hidden": "true" }, "⠿"),
        el("h3", {}, `Shot ${i + 1}`),
        time),
      el("button", { type: "button", class: "sb-panel-frame", title: "Draw this shot", "aria-label": `Draw shot ${i + 1}`,
                     onclick: () => go({ board, frame }) },
        Sketch.preview(frame, ratioOf(board), { image: frame.image })),
      linkedBlockNote(frame),
      el("div", { class: "sb-panel-fields" },
        fieldInputs(board, frame, FIELDS.map(f => f.key), {
          onChange: (key) => {
            if (key !== "duration") return;
            time.textContent = durationLabel(board, durationOf(frame));
            updateBoardMeta(board);
          },
        })),
      el("div", { class: "sb-panel-actions" },
        el("button", { type: "button", class: "comment-action", "aria-label": `Move shot ${i + 1} earlier`, disabled: i === 0, onclick: () => moveFrame(board, i, i - 1) }, "←"),
        el("button", { type: "button", class: "comment-action", "aria-label": `Move shot ${i + 1} later`, disabled: i === count - 1, onclick: () => moveFrame(board, i, i + 1) }, "→"),
        el("button", { type: "button", class: "comment-action", onclick: () => insertFrame(board, i + 1) }, "Insert after"),
        el("button", { type: "button", class: "comment-action", onclick: () => duplicateFrame(board, i) }, "Duplicate"),
        el("button", { type: "button", class: "comment-action", onclick: () => deleteFrame(board, i) }, "Delete")));

    // Drag and drop to reorder. Only the ⠿ handle starts a drag,
    // so selecting text in the notes still works.
    const handle = card.querySelector(".sb-drag");
    handle.addEventListener("pointerdown", () => { card.draggable = true; });
    handle.addEventListener("pointerup", () => { card.draggable = false; });
    card.addEventListener("dragstart", (event) => {
      dragged = frame;
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => {
      dragged = null;
      card.draggable = false;
      card.classList.remove("is-dragging");
    });
    card.addEventListener("dragover", (event) => {
      if (!dragged || dragged === frame) return;
      event.preventDefault();
      card.classList.add("is-drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("is-drop-target"));
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      card.classList.remove("is-drop-target");
      if (!dragged || dragged === frame) return;
      moveFrame(board, board.frames.indexOf(dragged), board.frames.indexOf(frame));
    });
    return card;
  }

  /* ---------- Changing the shot list ---------- */

  function moveFrame(board, from, to) {
    if (to < 0 || to >= board.frames.length) return;
    const [frame] = board.frames.splice(from, 1);
    board.frames.splice(to, 0, frame);
    save(board);
    updateBoardMeta(board);
    renderPanels(board, frame.id);
  }

  function insertFrame(board, at) {
    const frame = blankFrame(board.frames[at - 1]);
    board.frames.splice(at, 0, frame);
    save(board);
    updateBoardMeta(board);
    renderPanels(board, frame.id);
  }

  function duplicateFrame(board, i) {
    const copy = JSON.parse(JSON.stringify(board.frames[i]));
    copy.id = newId("f");
    board.frames.splice(i + 1, 0, copy);
    save(board);
    updateBoardMeta(board);
    renderPanels(board, copy.id);
  }

  async function deleteFrame(board, i) {
    if (board.frames.length === 1) {
      alert("A storyboard needs at least one shot.");
      return;
    }
    const frame = board.frames[i];
    const hasContent = !Sketch.isEmpty(frame) || frame.image || frame.action || frame.dialogue || frame.sound;
    if (hasContent && !confirm(`Delete shot ${i + 1}? This can't be undone.`)) return;
    board.frames.splice(i, 1);
    save(board);
    updateBoardMeta(board);
    renderPanels(board);
    await releaseImages([frame.image]);
  }

  function setUpBoard() {
    $("sb-back").addEventListener("click", (event) => { event.preventDefault(); go({}); });
    $("sb-edit").addEventListener("click", () => openDialog(readHash().board));
    $("sb-add").addEventListener("click", () => {
      const { board } = readHash();
      insertFrame(board, board.frames.length);
    });
    $("sb-show-notes").addEventListener("change", (event) => {
      view.notes = event.target.checked;
      saveView();
      $("sb-panels").classList.toggle("hide-notes", !view.notes);
    });
    $("sb-play").addEventListener("click", () => openPlayer(readHash().board, 0));
    $("sb-print").addEventListener("click", () => printBoard(readHash().board));
  }


  /* =========================================================
     3. ONE SHOT, FULL SIZE (drawing + notes)
     ========================================================= */

  function showFrame(board, frame) {
    const index = board.frames.indexOf(frame);
    document.title = `Shot ${index + 1} · ${board.name} · Storyboarder`;
    $("sb-frame-title").textContent = `Shot ${index + 1} of ${board.frames.length}`;
    $("sb-frame-board").textContent = board.name;
    $("sb-frame-prev").disabled = index === 0;
    $("sb-frame-next").disabled = index === board.frames.length - 1;

    editor = Sketch.createEditor({
      save: () => save(board),
      onRestore: () => renderFrameStage(board, frame),
      actions: [el("button", { type: "button", class: "small-btn", onclick: () => {
        if (editor.clear([frame])) renderFrameStage(board, frame);
      } }, "Clear")],
    });
    $("sb-toolbar-slot").replaceChildren(editor.toolbar);

    // Notes beside the drawing
    const timeNote = el("p", { class: "sb-frame-time" }, durationLabel(board, durationOf(frame)));
    const drawFields = () => $("sb-frame-fields").replaceChildren(
      ...fieldInputs(board, frame, FIELDS.map(f => f.key), {
        onChange: (key) => {
          if (key === "duration") timeNote.textContent = durationLabel(board, durationOf(frame));
          if (key === "shot") drawFraming(board, frame);
        },
      }),
      timeNote,
      blockLinkField(board, frame, drawFields));
    drawFields();

    $("sb-image-remove").hidden = !frame.image;
    $("sb-guides").checked = view.guides;
    $("sb-thirds").checked = view.thirds;
    $("sb-framing").checked = view.framing;
    renderFrameStage(board, frame);
  }

  function renderFrameStage(board, frame) {
    editor.reset();
    const stage = $("sb-frame-stage");
    stage.style.setProperty("--ratio", ratioOf(board));
    const page = editor.page(frame, ratioOf(board), { image: frame.image });
    page.append(el("div", { class: "sb-guides", "aria-hidden": "true" },
      el("div", { class: "sb-safe-action" }), el("div", { class: "sb-safe-title" }), el("div", { class: "sb-thirds" })));
    stage.replaceChildren(page);
    stage.classList.toggle("show-guides", view.guides);
    stage.classList.toggle("show-thirds", view.thirds);
    stage.classList.toggle("show-framing", view.framing);
    drawFraming(board, frame);
    sizeFrameStage();
  }


  /* =========================================================
     SHOT-SIZE FRAMING GUIDE
     A figure outline sized for the shot: close-up shows head and
     shoulders, medium shows the waist up, wide a small full figure.
     ========================================================= */

  /* For each shot: figures as { x: centre (0–1 of width), v: how many
     head-heights fill the frame height, top: space above the head (in
     head-heights), or feet: where the feet are (0–1 of height) } */
  const FRAMING = {
    "Extreme close-up":  [{ x: 0.5, v: 0.8, top: -0.25 }],
    "Close-up":          [{ x: 0.5, v: 1.9, top: 0.12 }],
    "Medium close-up":   [{ x: 0.5, v: 2.9, top: 0.15 }],
    "Medium":            [{ x: 0.5, v: 4.2, top: 0.2 }],
    "Medium wide":       [{ x: 0.5, v: 6.2, top: 0.25 }],
    "Full":              [{ x: 0.5, v: 9, top: 0.45 }],
    "Wide":              [{ x: 0.5, v: 17, feet: 0.82 }],
    "Extreme wide":      [{ x: 0.5, v: 52, feet: 0.78 }],
    "Over the shoulder": [{ x: 0.64, v: 3.2, top: 0.2 }, { x: 0.12, v: 1.7, top: 0.45, near: true }],
    "Two-shot":          [{ x: 0.33, v: 4.4, top: 0.2 }, { x: 0.67, v: 4.4, top: 0.2 }],
  };

  // A person drawn in head-heights (8 heads tall), centred on x = 0, top of head at y = 0
  const FIGURE = "M 0 0 C 0.24 0 0.37 0.2 0.37 0.47 C 0.37 0.75 0.22 0.95 0 0.95 C -0.22 0.95 -0.37 0.75 -0.37 0.47 C -0.37 0.2 -0.24 0 0 0 Z " +
    "M -0.15 0.93 L -0.15 1.12 Q -0.95 1.18 -1 1.5 L -0.88 3.3 L -0.78 4.05 L -0.48 7.9 L -0.1 7.9 L 0 4.4 L 0.1 7.9 L 0.48 7.9 L 0.78 4.05 L 0.88 3.3 L 1 1.5 Q 0.95 1.18 0.15 1.12 L 0.15 0.93 Z";

  function drawFraming(board, frame) {
    const page = $("sb-frame-stage").querySelector(".sketch-page");
    if (!page) return;
    page.querySelector(".sb-framing")?.remove();
    const figures = FRAMING[frame.shot];
    if (!figures) return;

    const W = 1000, H = W / ratioOf(board);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "sb-framing");
    svg.setAttribute("viewBox", `0 0 ${W} ${H.toFixed(1)}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    figures.forEach(f => {
      const h = H / f.v;                                   // one head-height in pixels
      const y = f.feet != null ? f.feet * H - 8 * h : f.top * h;
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", FIGURE);
      path.setAttribute("transform", `translate(${(f.x * W).toFixed(1)} ${y.toFixed(1)}) scale(${h.toFixed(3)})`);
      path.setAttribute("vector-effect", "non-scaling-stroke");
      if (f.near) path.setAttribute("class", "is-near");   // the shoulder in the foreground
      svg.append(path);
    });
    page.querySelector(".sb-guides").append(svg);
  }


  /* =========================================================
     LINKS TO BLOCKS IN A PAPER EDIT
     ========================================================= */

  // Every block in this project's edits: [{ edit, block, index }]
  function editBlocks() {
    if (!window.MediaCore) return [];
    return MediaCore.loadEdits().flatMap(edit => edit.blocks.map((block, index) => ({ edit, block, index })))
      .filter(({ block }) => block.kind !== "section");
  }

  function linkedBlock(frame) {
    if (!frame.blockRef) return null;
    return editBlocks().find(b => b.edit.id === frame.blockRef.editId && b.block.id === frame.blockRef.blockId) || null;
  }

  const describe = ({ edit, block, index }) =>
    `${edit.name} · ${index + 1}. ${MediaCore.blockSummary(MediaCore.loadMedia(), block, 48)}`;

  /* "↔ Edit 1 · 3. Soundbite · Sam: “…”" under a panel's frame */
  function linkedBlockNote(frame) {
    const link = linkedBlock(frame);
    if (!link) return null;
    return el("p", { class: "sb-link-note", title: "Linked block in your paper edit" }, "↔ ", describe(link));
  }

  /* The "Linked to" menu in the frame editor. Linking fills empty notes from the block. */
  function blockLinkField(board, frame, redraw) {
    const blocks = editBlocks();
    const select = el("select", { "aria-label": "Linked block in a paper edit" },
      el("option", { value: "" }, blocks.length ? "Not linked" : "No paper edits yet"),
      blocks.map(b => el("option", { value: `${b.edit.id}|${b.block.id}` }, describe(b))));
    select.value = frame.blockRef ? `${frame.blockRef.editId}|${frame.blockRef.blockId}` : "";
    if (select.value === "" && frame.blockRef) frame.blockRef = null;   // the block was deleted

    select.addEventListener("change", () => {
      if (!select.value) { delete frame.blockRef; save(board); return; }
      const [editId, blockId] = select.value.split("|");
      frame.blockRef = { editId, blockId };
      const { block } = blocks.find(b => b.edit.id === editId && b.block.id === blockId);
      const media = MediaCore.loadMedia();
      // Fill notes that are still empty
      const fill = {
        soundbite: () => {
          const src = MediaCore.sourceOf(media, block);
          const who = src.transcript ? MediaCore.speakerName(src.transcript, block.speaker) : block.speakerName;
          return { dialogue: `${who}: ${block.text}` };
        },
        narration: () => ({ dialogue: `VO: ${block.text}` }),
        broll: () => ({ action: block.text }),
        title: () => ({ action: `Title: ${block.text}` }),
      }[block.kind]?.() || {};
      for (const [key, value] of Object.entries(fill)) if (!String(frame[key] || "").trim()) frame[key] = value;
      if (block.kind === "soundbite" || block.seconds != null) frame.duration = Math.max(0.1, Math.round(MediaCore.blockSeconds(block) * 10) / 10);
      save(board);
      redraw();
    });

    return el("label", { class: "sb-field sb-field--textarea sb-link-field" }, "Linked to a block in your edit", select,
      el("a", { href: "media-and-transcripts.html#edit", class: "sb-link-open" }, "Open Text Edit →"));
  }

  /* As big as the column allows, but no taller than most of the window */
  function sizeFrameStage() {
    const stage = $("sb-frame-stage");
    if (stage.closest("[hidden]")) return;
    const { board } = readHash();
    if (!board) return;
    const maxHeight = Math.max(240, window.innerHeight * 0.7);
    const width = Math.min(stage.clientWidth, maxHeight * ratioOf(board));
    stage.style.setProperty("--frame-w", `${Math.floor(width)}px`);
  }

  function stepFrame(delta) {
    const { board, frame } = readHash();
    const next = board.frames[board.frames.indexOf(frame) + delta];
    if (next) go({ board, frame: next }, { replace: true });
  }

  function setUpFrame() {
    $("sb-frame-back").addEventListener("click", (event) => {
      event.preventDefault();
      const { board, frame } = readHash();
      scrollToId = frame?.id;
      go({ board });
    });
    $("sb-frame-prev").addEventListener("click", () => stepFrame(-1));
    $("sb-frame-next").addEventListener("click", () => stepFrame(1));
    window.addEventListener("resize", sizeFrameStage);
    new ResizeObserver(sizeFrameStage).observe($("sb-frame-stage"));

    // Guides
    $("sb-guides").addEventListener("change", (event) => {
      view.guides = event.target.checked;
      saveView();
      $("sb-frame-stage").classList.toggle("show-guides", view.guides);
    });
    $("sb-thirds").addEventListener("change", (event) => {
      view.thirds = event.target.checked;
      saveView();
      $("sb-frame-stage").classList.toggle("show-thirds", view.thirds);
    });
    $("sb-framing").addEventListener("change", (event) => {
      view.framing = event.target.checked;
      saveView();
      $("sb-frame-stage").classList.toggle("show-framing", view.framing);
    });

    // Photo behind the drawing (e.g. a location shot or reference still)
    const input = $("sb-image-input");
    $("sb-image-add").addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = "";
      if (!file) return;
      const { board, frame } = readHash();
      const id = newId("i");
      try {
        await FileStore.put(id, file);
      } catch (err) {
        alert(`Couldn't save the image: ${err.message}. Try opening the site from a local server.`);
        return;
      }
      const old = frame.image;
      frame.image = id;
      save(board);
      $("sb-image-remove").hidden = false;
      renderFrameStage(board, frame);
      await releaseImages([old]);
    });
    $("sb-image-remove").addEventListener("click", async () => {
      const { board, frame } = readHash();
      const old = frame.image;
      frame.image = null;
      save(board);
      $("sb-image-remove").hidden = true;
      renderFrameStage(board, frame);
      await releaseImages([old]);
    });

    // [ and ] step between shots (when not typing)
    document.addEventListener("keydown", (event) => {
      if ($("sb-frame").hidden || event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "[") stepFrame(-1);
      if (event.key === "]") stepFrame(1);
    });
  }


  /* =========================================================
     4. ANIMATIC PLAYER
     Plays every shot for its duration, with its notes as captions.
     ========================================================= */

  const player = { board: null, index: 0, offset: 0, startedAt: 0, playing: false, timer: 0 };
  const TICK_MS = 50;   // how often the player checks the time (a timer keeps going in background tabs)

  // Seconds from the start of the board to the start of shot i
  const startOf = (board, i) => board.frames.slice(0, i).reduce((sum, f) => sum + durationOf(f), 0);

  function openPlayer(board, index) {
    Object.assign(player, { board, index, offset: 0, playing: false });
    $("sb-player-title").textContent = board.name;
    showPlayerFrame(false);
    $("sb-player").showModal();
    play();
  }

  /* Draws the current shot. `animate` uses the previous shot's transition. */
  function showPlayerFrame(animate) {
    const { board, index } = player;
    const frame = board.frames[index];
    const previous = board.frames[index - 1];
    const screen = $("sb-player-screen");
    screen.style.setProperty("--ratio", ratioOf(board));

    const page = Sketch.preview(frame, ratioOf(board), { image: frame.image });
    if (animate && previous) {
      const effect = { "Dissolve": "dissolve", "Fade to black": "fade", "Wipe": "wipe" }[previous.transition];
      if (effect) page.classList.add(`sb-enter-${effect}`);
    }
    screen.replaceChildren(page);

    $("sb-player-shot").textContent = `Shot ${index + 1} of ${board.frames.length}` +
      [frame.shot, frame.move].filter(Boolean).map(s => ` · ${s}`).join("");
    $("sb-player-caption").replaceChildren(
      ...["action", "dialogue", "sound"].filter(k => frame[k].trim()).map(k =>
        el("p", { class: `sb-caption-${k}` }, frame[k])));
    updatePlayerTime();
  }

  function elapsed() {
    return player.offset + (player.playing ? (performance.now() - player.startedAt) / 1000 : 0);
  }

  function updatePlayerTime() {
    const { board, index } = player;
    const total = runtimeOf(board);
    const now = Math.min(total, startOf(board, index) + elapsed());
    let text = `${formatTime(now)} / ${formatTime(total)}`;
    if (board.kind === "animation") text += ` · frame ${Math.round(now * board.fps)}`;
    $("sb-player-time").textContent = text;
    $("sb-player-progress").style.setProperty("--progress", `${total ? (now / total) * 100 : 0}%`);
  }

  function tick() {
    if (!player.playing) return;
    const frame = player.board.frames[player.index];
    if (elapsed() >= durationOf(frame)) {
      if (player.index === player.board.frames.length - 1) {
        pause();
        player.offset = durationOf(frame);
        updatePlayerTime();
        return;
      }
      player.index++;
      player.offset = 0;
      player.startedAt = performance.now();
      showPlayerFrame(true);
    }
    updatePlayerTime();
    player.timer = setTimeout(tick, TICK_MS);
  }

  function play() {
    // At the very end, start again from the top
    const last = player.board.frames.length - 1;
    if (player.index === last && player.offset >= durationOf(player.board.frames[last])) {
      player.index = 0;
      player.offset = 0;
      showPlayerFrame(false);
    }
    player.playing = true;
    player.startedAt = performance.now();
    $("sb-player-toggle").textContent = "Pause";
    clearTimeout(player.timer);
    player.timer = setTimeout(tick, TICK_MS);
  }

  function pause() {
    player.offset = elapsed();
    player.playing = false;
    clearTimeout(player.timer);
    $("sb-player-toggle").textContent = "Play";
  }

  function jump(delta) {
    const next = player.index + delta;
    if (next < 0 || next >= player.board.frames.length) return;
    player.index = next;
    player.offset = 0;
    player.startedAt = performance.now();
    showPlayerFrame(false);
  }

  function setUpPlayer() {
    const dialog = $("sb-player");
    $("sb-player-toggle").addEventListener("click", () => player.playing ? pause() : play());
    $("sb-player-prev").addEventListener("click", () => jump(-1));
    $("sb-player-next").addEventListener("click", () => jump(1));
    $("sb-player-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", pause);

    // Click the progress bar to jump to that shot
    $("sb-player-progress").addEventListener("click", (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const target = (event.clientX - rect.left) / rect.width * runtimeOf(player.board);
      let i = 0;
      while (i < player.board.frames.length - 1 && startOf(player.board, i + 1) <= target) i++;
      player.index = i;
      player.offset = target - startOf(player.board, i);
      player.startedAt = performance.now();
      showPlayerFrame(false);
    });

    // Space plays/pauses, arrows step between shots
    dialog.addEventListener("keydown", (event) => {
      if (event.key === " " && !event.target.closest("button")) {   // buttons already click on Space
        event.preventDefault();
        player.playing ? pause() : play();
      }
      if (event.key === "ArrowLeft") jump(-1);
      if (event.key === "ArrowRight") jump(1);
    });
  }


  /* =========================================================
     5. PRINTING
     A simple sheet (drawings + notes as plain text) replaces
     the page while printing.
     ========================================================= */

  function buildPrintSheet(board) {
    const sheet = $("sb-print");
    sheet.classList.toggle("is-tall", ratioOf(board) < 1);
    sheet.replaceChildren(
      el("header", { class: "sb-print-head" },
        el("h2", {}, board.name),
        el("p", {}, $("sb-board-meta").textContent || `${plural(board.frames.length, "shot")}`)),
      el("div", { class: "sb-print-grid" }, board.frames.map((frame, i) =>
        el("article", { class: "sb-print-shot" },
          el("p", { class: "sb-print-label" },
            el("strong", {}, `Shot ${i + 1}`),
            ` · Scene ${frame.scene || "–"} · ${durationLabel(board, durationOf(frame))}`),
          Sketch.preview(frame, ratioOf(board), { image: frame.image }),
          el("dl", {}, FIELDS.filter(f => !["scene", "duration"].includes(f.key) && String(frame[f.key] || "").trim())
            .flatMap(f => [el("dt", {}, f.label), el("dd", {}, frame[f.key])]))))));
  }

  function printBoard(board) {
    showBoard(board);   // makes sure the summary line is current
    buildPrintSheet(board);
    // Give the drawings two frames to paint before the print preview opens
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  // Printing from the browser menu also gets the sheet
  window.addEventListener("beforeprint", () => {
    const { board } = readHash();
    if (board && !$("sb-print").childElementCount) buildPrintSheet(board);
  });
  window.addEventListener("afterprint", () => $("sb-print").replaceChildren());


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    setUpBoard();
    setUpFrame();
    setUpPlayer();
    $("sb-new").addEventListener("click", () => openDialog());
    window.addEventListener("hashchange", route);
    route();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    clearTimeout(saveTimer); saveTimer = 0;
    dragged = null;
    loadData();
    route();
    event.detail.handled = true;
  });
})();
