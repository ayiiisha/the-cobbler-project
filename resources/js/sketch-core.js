/* =========================================================
   sketch-core.js — drawing and text on a page
   ---------------------------------------------------------
   The drawing engine shared by the Zine Planner (Sketch tab)
   and the Storyboarder. Draw with a mouse, finger or drawing
   tablet (pen pressure makes lines thicker or thinner), and
   type text anywhere on a page.

   A "page" is any object with:
     { strokes: [stroke, ...], texts: [text, ...] }
   (a zine page, a storyboard frame, ...). It can hold other
   fields too; the engine only touches strokes and texts.

     stroke = { t: "pen" | "marker" | "eraser", c: "#1e1e24", w: 6,
                p: [x, y, pressure,  x, y, pressure, ...] }
              x and y are whole numbers from 0 to 10000 across the
              page (so drawings fit any screen size), pressure 0–100.
              w is the line width in tenths of a percent of page width.

     text   = { id, x, y, w, s, f, c, text }
              x, y, w as percentages of the page; s = font size as a
              percentage of page width; f = font; c = colour.

   Shortcuts: P pen · M marker · E eraser · T text
              Ctrl/Cmd+Z undo · Ctrl/Cmd+Shift+Z redo

   How a page uses it:
     Sketch.preview(page, ratio, { image })  → a read-only page
     const editor = Sketch.createEditor({ save, onRestore, actions })
       editor.toolbar                         → the tools, to place anywhere
       editor.page(page, ratio, { image })    → an editable page
       editor.reset()          before redrawing your pages
       editor.clear(pages)     wipe pages (undoable)
       editor.clearHistory()   after adding/removing pages
       editor.destroy()        when leaving

   `image` is an optional FileStore id shown behind the drawing.
   ========================================================= */
(() => {

  /* =========================================================
     SETTINGS
     ========================================================= */

  const PREFS_KEY = "sketchTools";   // remembers your tool, colour and sizes (this browser)
  const SCALE = 10000;               // stroke points run 0–10000 across the page
  const MAX_UNDO = 100;

  const TOOLS = [
    { id: "pen",    name: "Pen",    key: "p" },
    { id: "marker", name: "Marker", key: "m" },
    { id: "eraser", name: "Eraser", key: "e" },
    { id: "text",   name: "Text",   key: "t" },
  ];

  const COLORS = [
    ["#1e1e24", "Ink"], ["#ffffff", "White"], ["#e5484d", "Red"], ["#f5a524", "Orange"],
    ["#2eae5c", "Green"], ["#3e7bfa", "Blue"], ["#9b5de5", "Purple"], ["#f472b6", "Pink"],
  ];

  const FONTS = {
    glyphic: ["Faculty Glyphic", '"Faculty Glyphic", serif'],
    serif:   ["Serif",           'Georgia, "Times New Roman", serif'],
    sans:    ["Sans serif",      '"Helvetica Neue", Helvetica, Arial, sans-serif'],
    mono:    ["Typewriter",      '"Courier New", Courier, monospace'],
  };

  // Font sizes as a percentage of the page width
  const TEXT_SIZES = { S: 4, M: 6, L: 9, XL: 13 };

  const DEFAULT_PREFS = { tool: "pen", color: "#1e1e24", size: 6, font: "glyphic", textSize: "M" };


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round2 = (n) => Math.round(n * 100) / 100;
  const newTextId = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  // Only real "#rrggbb" colours get into the page's styles
  const safeColor = (c) => /^#[0-9a-f]{6}$/i.test(c) ? c : "#1e1e24";

  /* Builds an element; text children are added as plain text */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false));
    return node;
  }

  function loadPrefs() {
    try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY)) }; }
    catch { return { ...DEFAULT_PREFS }; }
  }

  // Only the drawing parts of a page (for undo)
  const drawingOf = (page) => JSON.stringify({ strokes: page.strokes, texts: page.texts });

  const isEmpty = (page) => !page.strokes.length && !page.texts.some(t => t.text.trim());


  /* ---------- Watching sizes (canvases redraw when they're resized) ---------- */

  const sizeWatchers = new Map();
  const shown = new WeakSet();   // nodes that have been on screen at least once
  const resizeObserver = new ResizeObserver(entries =>
    entries.forEach(entry => {
      shown.add(entry.target);
      sizeWatchers.get(entry.target)?.();
    }));

  function watchSize(node, callback) {
    // forget nodes that were on screen and have since been removed
    // (new nodes may not be on the page yet, so they're kept)
    for (const old of sizeWatchers.keys()) {
      if (shown.has(old) && !old.isConnected) { resizeObserver.unobserve(old); sizeWatchers.delete(old); }
    }
    sizeWatchers.set(node, callback);
    resizeObserver.observe(node);
  }


  /* =========================================================
     DRAWING STROKES
     ========================================================= */

  /* Matches the canvas's pixels to its size on screen (sharp on retina screens) */
  function fitCanvas(canvas) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /* Draws one stroke onto a canvas that is W × H pixels */
  function drawStroke(ctx, stroke, W, H) {
    const p = stroke.p;
    const n = p.length / 3;
    if (!n) return;

    const X = (i) => p[i * 3] / SCALE * W;
    const Y = (i) => p[i * 3 + 1] / SCALE * H;
    const base = (stroke.w / 1000) * W;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle = safeColor(stroke.c);
    if (stroke.t === "eraser") ctx.globalCompositeOperation = "destination-out";

    /* Marker: see-through, even width, drawn as one smooth path
       (so overlapping parts of the same line don't get darker) */
    if (stroke.t === "marker") {
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = base * 2.5;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      if (n === 1) ctx.lineTo(X(0) + 0.1, Y(0));
      for (let i = 1; i < n - 1; i++) {
        ctx.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
      }
      if (n > 1) ctx.lineTo(X(n - 1), Y(n - 1));
      ctx.stroke();
      ctx.restore();
      return;
    }

    /* Pen and eraser: width follows pen pressure (mice always press at 50) */
    const widthAt = (i) => stroke.t === "eraser"
      ? base * 2.5
      : base * (0.35 + 1.3 * p[i * 3 + 2] / 100);

    if (n === 1) {
      ctx.beginPath();
      ctx.arc(X(0), Y(0), widthAt(0) / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Smooth curve through the midpoints, one short piece at a time so the width can change
      let fromX = X(0), fromY = Y(0);
      for (let i = 1; i < n; i++) {
        const toX = i < n - 1 ? (X(i) + X(i + 1)) / 2 : X(i);
        const toY = i < n - 1 ? (Y(i) + Y(i + 1)) / 2 : Y(i);
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.quadraticCurveTo(X(i), Y(i), toX, toY);
        ctx.lineWidth = (widthAt(i - 1) + widthAt(i)) / 2;
        ctx.stroke();
        fromX = toX;
        fromY = toY;
      }
    }
    ctx.restore();
  }

  /* Clears a canvas and draws a list of strokes on it */
  function paint(canvas, strokes) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(s => drawStroke(ctx, s, canvas.width, canvas.height));
  }


  /* =========================================================
     PAGES (shared by editors and previews)
     ========================================================= */

  /* The text box styles: position, width, size, font and colour */
  function applyTextStyle(node, t) {
    node.style.left = `${Number(t.x) || 0}%`;
    node.style.top = `${Number(t.y) || 0}%`;
    node.style.width = `${Number(t.w) || 40}%`;
    node.style.setProperty("--fs", Number(t.s) || TEXT_SIZES.M);
    node.style.color = safeColor(t.c);
    node.style.fontFamily = (FONTS[t.f] || FONTS.glyphic)[1];
  }

  /* ---------- Background images (kept in FileStore) ---------- */

  const imageUrls = new Map();   // FileStore id → address the browser can show

  async function imageUrl(id) {
    if (!imageUrls.has(id)) {
      imageUrls.set(id, window.FileStore.get(id)
        .then(blob => blob ? URL.createObjectURL(blob) : null)
        .catch(() => null));
    }
    return imageUrls.get(id);
  }

  /* An empty page: optional photo, a canvas for drawings, a layer for text on top */
  function buildPage(ratio, image) {
    const canvas = el("canvas", { class: "sketch-canvas" });
    const layer = el("div", { class: "sketch-text-layer" });
    const root = el("div", { class: "sketch-page" }, canvas, layer);
    root.style.setProperty("--ratio", ratio);

    if (image && window.FileStore) {
      const img = el("img", { class: "sketch-image", alt: "" });
      root.prepend(img);
      imageUrl(image).then(url => { if (url) img.src = url; else img.remove(); });
    }
    return { root, canvas, layer };
  }

  /* A read-only page (thumbnails, covers, players) */
  function preview(page, ratio, { image } = {}) {
    const { root, canvas, layer } = buildPage(ratio, image);
    root.classList.add("is-preview");
    page.texts.forEach(t => {
      const box = el("div", { class: "sketch-text" }, t.text);
      applyTextStyle(box, t);
      layer.append(box);
    });
    watchSize(canvas, () => { fitCanvas(canvas); paint(canvas, page.strokes); });
    return root;
  }


  /* =========================================================
     THE EDITOR (one at a time)
     ========================================================= */

  let E = null;   // the open editor's state

  /* options:
       save()            store everything (called after each change)
       onRestore(page)   undo/redo changed `page`: redraw so it's on screen
       onToolChange(id)  optional, e.g. to update a hint
       actions           optional extra buttons for the end of the toolbar */
  function createEditor({ save, onRestore, onToolChange, actions = [] }) {
    E?.destroy();

    E = {
      save, onRestore, onToolChange,
      prefs: loadPrefs(),
      undo: [], redo: [],
      pages: new Set(),     // editable page elements on screen
      drawing: null,        // the stroke being drawn
      textSession: null,    // the text box being typed in
      currentText: null,    // the last text box used (toolbar changes apply to it)
      saveTimer: 0,
    };
    E.toolbar = buildToolbar(actions);
    document.addEventListener("keydown", onKey);

    const api = {
      toolbar: E.toolbar,
      tool: () => E.prefs.tool,
      page: editablePage,
      reset,
      clear,
      isEmpty,
      clearHistory() { E.undo = []; E.redo = []; updateUndoButtons(); },
      destroy,
    };
    E.api = api;
    return api;
  }

  function destroy() {
    if (!E) return;
    endTextSession();
    if (E.saveTimer) { clearTimeout(E.saveTimer); E.save(); }
    document.removeEventListener("keydown", onKey);
    E = null;
  }

  /* Call before redrawing pages: finishes typing and forgets old page elements */
  function reset() {
    endTextSession();
    E.currentText = null;
    E.pages.clear();
  }

  /* Wipes pages' drawings and text (one undo step) */
  function clear(pages) {
    endTextSession();
    pages = pages.filter(p => !isEmpty(p));
    if (!pages.length) return false;
    pushUndo(snapshot(pages));
    pages.forEach(p => { p.strokes = []; p.texts = []; });
    persist();
    return true;
  }


  /* ---------- Saving ---------- */

  function persist() {
    clearTimeout(E.saveTimer);
    E.saveTimer = 0;
    E.save();
  }

  // For typing: wait for a pause before saving
  function persistSoon() {
    clearTimeout(E.saveTimer);
    E.saveTimer = setTimeout(persist, 500);
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(E.prefs)); } catch {}
  }


  /* ---------- Undo / redo ----------
     Each step remembers how some pages looked before a change. */

  const snapshot = (pages) => pages.map(page => ({ page, before: drawingOf(page) }));

  function pushUndo(step) {
    E.undo.push(step);
    if (E.undo.length > MAX_UNDO) E.undo.shift();
    E.redo.length = 0;   // emptied in place: restore() may be holding this list
    updateUndoButtons();
  }

  function restore(from, to) {
    endTextSession();
    const step = from.pop();
    if (!step) return;
    to.push(snapshot(step.map(s => s.page)));
    step.forEach(({ page, before }) => Object.assign(page, JSON.parse(before)));
    persist();
    updateUndoButtons();
    E.onRestore(step[0].page);
  }

  const undo = () => restore(E.undo, E.redo);
  const redo = () => restore(E.redo, E.undo);

  function updateUndoButtons() {
    E.toolbar.querySelector("[data-action=undo]").disabled = !E.undo.length;
    E.toolbar.querySelector("[data-action=redo]").disabled = !E.redo.length;
  }


  /* =========================================================
     TOOLBAR
     ========================================================= */

  function buildToolbar(actions) {
    const prefs = E.prefs;

    const toolButtons = TOOLS.map(tool =>
      el("button", {
        type: "button", class: "tool-btn", dataset: { tool: tool.id },
        "aria-pressed": String(prefs.tool === tool.id),
        title: `${tool.name} (${tool.key.toUpperCase()})`,
        onclick: () => setTool(tool.id),
      }, tool.name));

    const swatches = COLORS.map(([color, name]) => {
      const button = el("button", {
        type: "button", class: "swatch", title: name, "aria-label": name, dataset: { color },
        "aria-pressed": String(prefs.color === color),
        onclick: () => setColor(color),
      });
      button.style.setProperty("--swatch", color);
      return button;
    });

    const custom = el("input", { type: "color", class: "swatch-custom", value: safeColor(prefs.color), "aria-label": "Custom colour", title: "Custom colour" });
    custom.addEventListener("input", () => setColor(custom.value, { live: true }));
    custom.addEventListener("change", () => setColor(custom.value));

    const sizeInput = el("input", { type: "range", min: "1", max: "40", value: String(prefs.size), "aria-label": "Line width" });
    sizeInput.addEventListener("input", () => { prefs.size = Number(sizeInput.value); savePrefs(); });

    const fontSelect = el("select", { "aria-label": "Font" },
      Object.entries(FONTS).map(([id, [name]]) => el("option", { value: id }, name)));
    fontSelect.value = prefs.font;
    fontSelect.addEventListener("change", () => {
      prefs.font = fontSelect.value;
      savePrefs();
      styleCurrentText({ f: prefs.font });
    });

    const textSizeSelect = el("select", { "aria-label": "Text size" },
      Object.keys(TEXT_SIZES).map(key => el("option", { value: key }, key)));
    textSizeSelect.value = prefs.textSize;
    textSizeSelect.addEventListener("change", () => {
      prefs.textSize = textSizeSelect.value;
      savePrefs();
      styleCurrentText({ s: TEXT_SIZES[prefs.textSize] });
    });

    return el("div", { class: "sketch-toolbar", role: "toolbar", "aria-label": "Drawing tools" },
      el("div", { class: "tool-group", role: "group", "aria-label": "Tool" }, toolButtons),
      el("div", { class: "tool-group swatches", role: "group", "aria-label": "Colour" }, swatches, custom),
      el("label", { class: "tool-group tool-line-width", hidden: prefs.tool === "text" }, "Width", sizeInput),
      el("div", { class: "tool-group tool-text-options", hidden: prefs.tool !== "text" },
        el("label", {}, "Font ", fontSelect),
        el("label", {}, "Size ", textSizeSelect)),
      el("div", { class: "tool-group" },
        el("button", { type: "button", class: "small-btn", dataset: { action: "undo" }, title: "Undo (Ctrl/Cmd+Z)", disabled: true, onclick: undo }, "Undo"),
        el("button", { type: "button", class: "small-btn", dataset: { action: "redo" }, title: "Redo (Ctrl/Cmd+Shift+Z)", disabled: true, onclick: redo }, "Redo"),
        actions));
  }

  function setTool(id) {
    if (E.prefs.tool === "text" && id !== "text") {
      document.activeElement?.blur?.();
      setCurrentText(null);
    }
    E.prefs.tool = id;
    savePrefs();
    E.toolbar.querySelectorAll(".tool-btn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === id)));
    E.toolbar.querySelector(".tool-text-options").hidden = id !== "text";
    E.toolbar.querySelector(".tool-line-width").hidden = id === "text";
    E.pages.forEach(root => { root.dataset.tool = id; });
    E.onToolChange?.(id);
  }

  // `live` = still dragging in the colour picker (don't fill the undo list yet)
  function setColor(color, { live = false } = {}) {
    E.prefs.color = safeColor(color);
    savePrefs();
    E.toolbar.querySelectorAll(".swatch").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.color === E.prefs.color)));
    E.toolbar.querySelector(".swatch-custom").value = E.prefs.color;
    if (!live) styleCurrentText({ c: E.prefs.color });
  }


  /* =========================================================
     ONE EDITABLE PAGE
     ========================================================= */

  function editablePage(page, ratio, { image } = {}) {
    const { root, canvas, layer } = buildPage(ratio, image);
    const cache = document.createElement("canvas");   // finished strokes, so live drawing stays fast
    const view = { page, root, canvas, layer, cache };
    root.dataset.tool = E.prefs.tool;
    E.pages.add(root);

    watchSize(canvas, () => {
      fitCanvas(canvas);
      cache.width = canvas.width;
      cache.height = canvas.height;
      paint(cache, page.strokes);
      showCache(view);
    });

    // Drawing
    canvas.addEventListener("pointerdown", (event) => startStroke(event, view));
    canvas.addEventListener("pointermove", (event) => moveStroke(event, view));
    canvas.addEventListener("pointerup", (event) => endStroke(event, view));
    canvas.addEventListener("pointercancel", (event) => endStroke(event, view));

    // Text: click an empty spot to add a box
    layer.addEventListener("pointerdown", (event) => {
      if (E.prefs.tool !== "text" || event.target !== layer) return;
      event.preventDefault();
      createText(view, event);
    });
    page.texts.forEach(t => layer.append(textBox(view, t)));

    return root;
  }

  function showCache(view) {
    const ctx = view.canvas.getContext("2d");
    ctx.clearRect(0, 0, view.canvas.width, view.canvas.height);
    ctx.drawImage(view.cache, 0, 0);
  }


  /* ---------- Drawing a stroke ---------- */

  function startStroke(event, view) {
    if (!E || E.drawing || E.prefs.tool === "text") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    try { view.canvas.setPointerCapture(event.pointerId); } catch {}   // keeps the line going past the page edge
    E.drawing = {
      view,
      pointerId: event.pointerId,
      rect: view.canvas.getBoundingClientRect(),
      stroke: { t: E.prefs.tool, c: E.prefs.color, w: E.prefs.size, p: [] },
      frame: 0,
    };
    addPoint(event);
    drawLive();
  }

  function addPoint(event) {
    const { rect, stroke } = E.drawing;
    const p = stroke.p;
    const x = Math.round((event.clientX - rect.left) / rect.width * SCALE);
    const y = Math.round((event.clientY - rect.top) / rect.height * SCALE);
    // Pens report real pressure; mice and fingers count as a medium press
    const pressure = event.pointerType === "pen" ? Math.round((event.pressure || 0.5) * 100) : 50;

    // Skip points less than ~1.5 screen pixels from the last one (keeps saved data small)
    const n = p.length;
    if (n) {
      const dx = (x - p[n - 3]) / SCALE * rect.width;
      const dy = (y - p[n - 2]) / SCALE * rect.height;
      if (Math.hypot(dx, dy) < 1.5) return;
    }
    p.push(clamp(x, -500, SCALE + 500), clamp(y, -500, SCALE + 500), clamp(pressure, 1, 100));
  }

  function moveStroke(event, view) {
    const d = E?.drawing;
    if (!d || d.view !== view || d.pointerId !== event.pointerId) return;
    // Pens send extra in-between points; use them for smoother lines
    const events = event.getCoalescedEvents?.() || [];
    (events.length ? events : [event]).forEach(addPoint);
    if (!d.frame) d.frame = requestAnimationFrame(drawLive);
  }

  // Shows finished strokes plus the one being drawn
  function drawLive() {
    const d = E?.drawing;
    if (!d) return;
    d.frame = 0;
    showCache(d.view);
    drawStroke(d.view.canvas.getContext("2d"), d.stroke, d.view.canvas.width, d.view.canvas.height);
  }

  function endStroke(event, view) {
    const d = E?.drawing;
    if (!d || d.view !== view || d.pointerId !== event.pointerId) return;
    cancelAnimationFrame(d.frame);
    E.drawing = null;
    if (!d.stroke.p.length) return;

    pushUndo(snapshot([view.page]));
    view.page.strokes.push(d.stroke);
    drawStroke(view.cache.getContext("2d"), d.stroke, view.cache.width, view.cache.height);
    showCache(view);
    persist();
  }


  /* =========================================================
     TEXT BOXES
     ========================================================= */

  function textBox(view, t) {
    const body = el("div", { class: "sketch-text-body", spellcheck: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Text" });
    body.textContent = t.text;
    try { body.contentEditable = "plaintext-only"; } catch { body.contentEditable = "true"; }

    const box = el("div", { class: "sketch-text is-editable", dataset: { id: t.id } },
      body,
      el("button", { type: "button", class: "sketch-text-move", "aria-label": "Move text box", title: "Drag to move" }, "⠿"),
      el("button", { type: "button", class: "sketch-text-width", "aria-label": "Change width", title: "Drag to change the width" }),
      el("button", { type: "button", class: "sketch-text-delete", "aria-label": "Delete text box", title: "Delete text box" }, "×"));
    applyTextStyle(box, t);

    body.addEventListener("focus", () => beginTextSession(view, t, box));
    // (only ends this box's session: a new box may already have taken over)
    body.addEventListener("blur", () => { if (E?.textSession?.t === t) endTextSession(); });
    body.addEventListener("input", () => {
      t.text = body.innerText.replace(/\n$/, "");
      persistSoon();
    });
    // Pasting keeps only the words, not the formatting
    body.addEventListener("paste", (event) => {
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    });

    box.querySelector(".sketch-text-move").addEventListener("pointerdown", (event) => dragText(event, view, t, box, "move"));
    box.querySelector(".sketch-text-width").addEventListener("pointerdown", (event) => dragText(event, view, t, box, "width"));
    box.querySelector(".sketch-text-delete").addEventListener("pointerdown", (event) => event.preventDefault());
    box.querySelector(".sketch-text-delete").addEventListener("click", () => deleteText(view, t, box));
    return box;
  }

  function createText(view, event) {
    const rect = view.root.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width * 100, 0, 90);
    const y = clamp((event.clientY - rect.top) / rect.height * 100, 0, 95);
    const t = {
      id: newTextId(),
      x: round2(x), y: round2(y), w: round2(Math.max(15, Math.min(50, 100 - x))),
      s: TEXT_SIZES[E.prefs.textSize] || TEXT_SIZES.M,
      f: E.prefs.font,
      c: E.prefs.color,
      text: "",
    };
    const before = snapshot([view.page]);
    view.page.texts.push(t);
    const box = textBox(view, t);
    view.layer.append(box);
    endTextSession();
    E.textSession = { view, t, box, before };
    setCurrentText({ view, t, box });
    box.querySelector(".sketch-text-body").focus();
  }

  /* Typing in a box is one undo step, from focus to blur */
  function beginTextSession(view, t, box) {
    if (E.textSession?.t === t) return;
    endTextSession();
    E.textSession = { view, t, box, before: snapshot([view.page]) };
    setCurrentText({ view, t, box });
  }

  function endTextSession() {
    const session = E?.textSession;
    if (!session) return;
    E.textSession = null;
    const { view, t, box, before } = session;

    // Empty boxes disappear when you click away
    if (!t.text.trim()) {
      view.page.texts = view.page.texts.filter(other => other !== t);
      box.remove();
      if (E.currentText?.t === t) setCurrentText(null);
    }
    if (drawingOf(view.page) !== before[0].before) {
      pushUndo(before);
      persist();
    }
  }

  // The box toolbar changes (font, size, colour) apply to
  function setCurrentText(current) {
    E.currentText?.box.classList.remove("is-current");
    E.currentText = current;
    current?.box.classList.add("is-current");
  }

  function styleCurrentText(change) {
    const current = E.currentText;
    if (E.prefs.tool !== "text" || !current?.box.isConnected) return;
    endTextSession();
    const before = snapshot([current.view.page]);
    Object.assign(current.t, change);
    applyTextStyle(current.box, current.t);
    pushUndo(before);
    persist();
  }

  function deleteText(view, t, box) {
    if (E.textSession?.t === t) E.textSession = null;
    const before = snapshot([view.page]);
    view.page.texts = view.page.texts.filter(other => other !== t);
    box.remove();
    if (E.currentText?.t === t) setCurrentText(null);
    if (t.text.trim()) pushUndo(before);
    persist();
  }

  /* Dragging the ⠿ handle moves a box; dragging its right edge changes the width */
  function dragText(event, view, t, box, mode) {
    event.preventDefault();      // keeps focus (and the text) where it is
    event.stopPropagation();
    const handle = event.currentTarget;
    try { handle.setPointerCapture(event.pointerId); } catch {}
    setCurrentText({ view, t, box });

    const page = view.root.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, tx: t.x, ty: t.y, tw: t.w };
    const before = snapshot([view.page]);

    const move = (e) => {
      const dx = (e.clientX - start.x) / page.width * 100;
      const dy = (e.clientY - start.y) / page.height * 100;
      if (mode === "move") {
        t.x = round2(clamp(start.tx + dx, -t.w + 5, 95));
        t.y = round2(clamp(start.ty + dy, -2, 97));
      } else {
        t.w = round2(clamp(start.tw + dx, 8, 110 - t.x));
      }
      applyTextStyle(box, t);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      if (drawingOf(view.page) !== before[0].before) {
        pushUndo(before);
        persist();
      }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }


  /* =========================================================
     KEYBOARD SHORTCUTS
     ========================================================= */

  function onKey(event) {
    if (!E || !E.toolbar.isConnected || E.toolbar.closest("[hidden]")) return;
    const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
    const ctrl = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (ctrl && !typing && (key === "z" || key === "y")) {
      event.preventDefault();
      (key === "y" || event.shiftKey) ? redo() : undo();
      return;
    }
    if (ctrl || event.altKey || typing || document.querySelector("dialog[open]")) return;

    const tool = TOOLS.find(t => t.key === key);
    if (tool) setTool(tool.id);
  }


  /* ---------- Let other scripts use the engine ---------- */
  window.Sketch = { preview, createEditor, isEmpty, el };
})();
