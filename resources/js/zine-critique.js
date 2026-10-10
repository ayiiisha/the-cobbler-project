/* =========================================================
   zine-critique.js — the Critique tab of the Zine Planner
   ---------------------------------------------------------
   Upload existing files (page scans, mock-ups, PDFs, video…)
   and comment on them:
     • Images: click a spot to pin a comment to it
     • PDFs:   comments can point to a page number
     • Video and audio: comments can point to a moment
     • Anything else: general comments, plus a download button

   The files themselves are kept by file-store.js (IndexedDB).
   Each zine stores the file details and comments:
     zine.files = [{ id, blob, name, type, size, added, comments: [thread, ...] }]
   Comment threads use the sitewide comments (comments.js).

   Used by zine-planner.js:
     ZineCritique.mount(panel, zine, { save })
     ZineCritique.unmount()
   ========================================================= */
(() => {

  const { el, newId, plural, formatDate, releaseFiles } = window.Zine;

  const TEXT_PREVIEW_LIMIT = 200000;   // characters shown for text files


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  // "1.2 MB"
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }

  // 83.4 → "1:23"
  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
  }

  /* What kind of preview a file gets */
  function kindOf(file) {
    const type = file.type || "";
    const ext = file.name.split(".").pop().toLowerCase();
    if (type.startsWith("image/")) return "image";
    if (type === "application/pdf" || ext === "pdf") return "pdf";
    if (type.startsWith("video/")) return "video";
    if (type.startsWith("audio/")) return "audio";
    if (type.startsWith("text/") || ["md", "txt", "csv", "json"].includes(ext)) return "text";
    return "other";
  }

  const KIND_NAMES = { image: "Image", pdf: "PDF", video: "Video", audio: "Audio", text: "Text", other: "File" };

  const openCount = (file) => file.comments.filter(c => !c.resolved).length;


  /* =========================================================
     MOUNT / UNMOUNT
     ========================================================= */

  let C = null;   // everything about the open Critique tab (null when closed)

  function mount(panel, zine, { save }) {
    unmount();
    C = {
      panel, zine, save,
      selectedId: zine.files[0]?.id || null,
      urls: new Map(),        // blob id → object URL (released on unmount)
      pendingPin: null,       // { x, y } while placing a new pin
      showResolved: false,
      threads: null,          // the mounted comment list
      media: null,            // the <video>/<audio>/<iframe> being shown
      renderToken: 0,
    };
    panel.append(buildLayout());
    renderFiles();
    renderSelected();
  }

  function unmount() {
    if (!C) return;
    C.urls.forEach(url => URL.revokeObjectURL(url));
    C = null;
  }

  const $1 = (selector) => C.panel.querySelector(selector);
  const selectedFile = () => C.zine.files.find(f => f.id === C.selectedId) || null;

  function setStatus(message) {
    $1(".critique-status").textContent = message;
  }


  /* =========================================================
     LAYOUT
     ========================================================= */

  function buildLayout() {
    const input = el("input", { type: "file", multiple: true, hidden: true });
    input.addEventListener("change", () => {
      addFiles([...input.files]);
      input.value = "";
    });

    const drop = el("div", { class: "drop-zone critique-drop", tabindex: "0", role: "button" },
      "Drop files here, or click to choose");
    drop.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); input.click(); }
    });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
      addFiles([...event.dataTransfer.files]);
    });

    const showResolved = el("input", { type: "checkbox" });
    showResolved.addEventListener("change", () => {
      C.showResolved = showResolved.checked;
      C.threads?.render();
      renderPins();
    });

    return el("div", { class: "critique" },
      el("section", { class: "critique-files", "aria-label": "Files" },
        el("div", { class: "section-head" },
          el("h3", {}, "Files"),
          el("button", { type: "button", class: "small-btn", onclick: () => input.click() }, "Upload files"),
          input),
        drop,
        el("p", { class: "critique-status", role: "status" }),
        el("ul", { class: "critique-file-list" })),
      el("div", { class: "critique-main" },
        el("section", { class: "critique-viewer", "aria-label": "Preview" }),
        el("section", { class: "critique-comments", "aria-label": "Comments" },
          el("div", { class: "critique-comments-head" },
            el("h3", {}, "Comments"),
            el("label", { class: "comments-check" }, showResolved, " Show resolved")),
          el("div", { class: "critique-composer" }),
          el("div", { class: "critique-threads" }))));
  }


  /* =========================================================
     FILES: upload, list, remove
     ========================================================= */

  async function addFiles(list) {
    if (!list.length) return;
    setStatus(`Saving ${plural(list.length, "file")}…`);
    let added = 0;
    const failed = [];

    for (const file of list) {
      const id = newId("f");
      try {
        await FileStore.put(id, file);
      } catch (err) {
        failed.push(`${file.name} (${err.message})`);
        continue;
      }
      if (!C) return;   // tab was closed while saving
      C.zine.files.push({
        id, blob: id, name: file.name, type: file.type, size: file.size,
        added: Date.now(), comments: [],
      });
      C.selectedId = id;
      added++;
    }

    if (added) C.save();
    setStatus([
      added && `${plural(added, "file")} added.`,
      failed.length && `Couldn't save: ${failed.join(", ")}. Try opening the site from a local server (see the change log).`,
    ].filter(Boolean).join(" "));
    renderFiles();
    if (added) renderSelected();
  }

  function renderFiles() {
    const list = $1(".critique-file-list");
    list.replaceChildren();
    if (!C.zine.files.length) {
      list.append(el("li", { class: "critique-file-empty" }, "No files yet. Upload page scans, mock-ups or PDFs to get feedback on them."));
      return;
    }
    C.zine.files.forEach(file => {
      const open = openCount(file);
      list.append(el("li", { class: "critique-file" + (file.id === C.selectedId ? " is-current" : "") },
        el("button", {
          type: "button", class: "critique-file-open",
          "aria-current": file.id === C.selectedId ? "true" : null,
          onclick: () => { C.selectedId = file.id; renderFiles(); renderSelected(); },
        },
          el("span", { class: "critique-file-name" }, file.name),
          el("span", { class: "critique-file-meta" },
            `${KIND_NAMES[kindOf(file)]} · ${formatBytes(file.size)}` + (open ? ` · ${plural(open, "open comment")}` : ""))),
        el("button", {
          type: "button", class: "comment-action", "aria-label": `Remove ${file.name}`,
          onclick: () => removeFile(file),
        }, "Remove")));
    });
  }

  async function removeFile(file) {
    const n = file.comments.length;
    if (!confirm(`Remove “${file.name}”${n ? ` and its ${plural(n, "comment")}` : ""}? This can't be undone.`)) return;
    const files = C.zine.files;
    const index = files.indexOf(file);
    files.splice(index, 1);
    C.save();
    if (C.selectedId === file.id) C.selectedId = files[Math.min(index, files.length - 1)]?.id || null;
    renderFiles();
    renderSelected();
    await releaseFiles([file.blob]);
  }

  /* An address the browser can show the stored file from */
  async function urlFor(file) {
    if (C.urls.has(file.blob)) return C.urls.get(file.blob);
    const blob = await FileStore.get(file.blob);
    if (!blob || !C) return null;
    const url = URL.createObjectURL(blob);
    C.urls.set(file.blob, url);
    return url;
  }


  /* =========================================================
     THE SELECTED FILE: preview + comments
     ========================================================= */

  async function renderSelected() {
    const viewer = $1(".critique-viewer");
    const file = selectedFile();
    const token = ++C.renderToken;
    C.pendingPin = null;
    C.media = null;

    if (!file) {
      viewer.replaceChildren(el("p", { class: "critique-placeholder" }, "Choose or upload a file to preview it here."));
      $1(".critique-composer").replaceChildren();
      $1(".critique-threads").replaceChildren();
      C.threads = null;
      return;
    }

    viewer.replaceChildren(el("p", { class: "critique-placeholder" }, "Loading…"));
    renderComposer(file);
    mountThreads(file);

    let url = null;
    try { url = await urlFor(file); } catch {}
    if (!C || token !== C.renderToken) return;   // another file was chosen meanwhile

    const head = el("div", { class: "critique-viewer-head" },
      el("h3", { class: "critique-viewer-title" }, file.name),
      el("p", { class: "critique-file-meta" }, `${KIND_NAMES[kindOf(file)]} · ${formatBytes(file.size)} · added ${formatDate(file.added)}`),
      url && el("div", { class: "comment-actions" },
        el("a", { class: "small-btn", href: url, download: file.name }, "Download"),
        el("a", { class: "small-btn", href: url, target: "_blank", rel: "noopener" }, "Open in new tab")));

    if (!url) {
      viewer.replaceChildren(head, el("p", { class: "critique-placeholder" },
        "This file isn't stored in this browser. Uploaded files stay on the computer they were added on, and aren't part of project backups. You can still read and add comments."));
      return;
    }

    viewer.replaceChildren(head, await buildPreview(file, url));
    renderPins();
  }

  async function buildPreview(file, url) {
    const kind = kindOf(file);

    if (kind === "image") {
      const img = el("img", { src: url, alt: file.name, class: "critique-image", draggable: "false" });
      const pins = el("div", { class: "critique-pins" });
      img.addEventListener("click", (event) => {
        const rect = img.getBoundingClientRect();
        C.pendingPin = {
          x: Math.round((event.clientX - rect.left) / rect.width * 1000) / 10,
          y: Math.round((event.clientY - rect.top) / rect.height * 1000) / 10,
        };
        renderPins();
        renderComposer(file);
        $1(".critique-composer textarea").focus();
      });
      img.addEventListener("error", () =>
        img.replaceWith(el("p", { class: "critique-placeholder" }, "This browser can't show this image type.")));
      return el("div", { class: "critique-image-wrap" }, img, pins);
    }

    if (kind === "pdf") {
      C.media = el("iframe", { class: "critique-pdf", src: url, title: file.name });
      return C.media;
    }

    if (kind === "video" || kind === "audio") {
      C.media = el(kind, { class: `critique-${kind}`, src: url, controls: true, preload: "metadata" });
      C.media.addEventListener("timeupdate", updateTimeLabel);
      return C.media;
    }

    if (kind === "text") {
      const blob = await FileStore.get(file.blob);
      const text = (await blob.text()).slice(0, TEXT_PREVIEW_LIMIT);
      return el("pre", { class: "critique-text" }, text);
    }

    return el("p", { class: "critique-placeholder" },
      "No preview for this kind of file. Download it to open it, and leave comments here.");
  }


  /* ---------- Image pins ---------- */

  const isPinned = (thread) => thread.anchor && thread.anchor.x != null;

  // Pin numbers stay the same whether resolved ones are shown or not
  function pinNumber(file, thread) {
    return file.comments.filter(isPinned).indexOf(thread) + 1;
  }

  function renderPins() {
    const layer = $1(".critique-pins");
    const file = selectedFile();
    if (!layer || !file) return;
    layer.replaceChildren();
    const selected = C.threads?.selectedId();

    file.comments.filter(isPinned).forEach(thread => {
      if (thread.resolved && !C.showResolved) return;
      const pin = el("button", {
        type: "button",
        class: ["critique-pin", thread.resolved && "is-resolved", thread.id === selected && "is-selected"].filter(Boolean).join(" "),
        "aria-label": `Comment ${pinNumber(file, thread)}: ${thread.text.slice(0, 60)}`,
        onclick: () => { C.threads.select(thread.id); renderPins(); },
      }, String(pinNumber(file, thread)));
      pin.style.left = `${thread.anchor.x}%`;
      pin.style.top = `${thread.anchor.y}%`;
      layer.append(pin);
    });

    if (C.pendingPin) {
      const pin = el("span", { class: "critique-pin is-pending", "aria-hidden": "true" }, "+");
      pin.style.left = `${C.pendingPin.x}%`;
      pin.style.top = `${C.pendingPin.y}%`;
      layer.append(pin);
    }
  }


  /* ---------- Writing a comment ---------- */

  function updateTimeLabel() {
    const label = $1(".critique-time-label");
    if (label && C.media) label.textContent = formatClock(C.media.currentTime);
  }

  function renderComposer(file) {
    const kind = kindOf(file);
    const textarea = el("textarea", { rows: "3", required: true, placeholder: "What works? What could change?", "aria-label": "Comment" });
    CobblerComments.submitOnCtrlEnter(textarea);

    // Where the comment points (depends on the file type)
    let anchorField = null;
    let pageInput = null;
    let timeBox = null;

    if (kind === "image") {
      anchorField = C.pendingPin
        ? el("p", { class: "critique-anchor" }, "Pinned to the spot marked +. ",
            el("button", { type: "button", class: "comment-action", onclick: () => {
              C.pendingPin = null;
              renderPins();
              renderComposer(file);
            } }, "Remove pin"))
        : el("p", { class: "critique-anchor" }, "Tip: click the image to pin your comment to a spot.");
    }
    if (kind === "pdf") {
      pageInput = el("input", { type: "number", min: "1", step: "1", inputmode: "numeric", class: "critique-page-input" });
      anchorField = el("label", { class: "critique-anchor" }, "Page (optional) ", pageInput);
    }
    if (kind === "video" || kind === "audio") {
      timeBox = el("input", { type: "checkbox", checked: true });
      anchorField = el("label", { class: "critique-anchor" }, timeBox, " At ",
        el("span", { class: "critique-time-label" }, formatClock(C.media?.currentTime || 0)));
    }

    const form = el("form", { class: "comment-form" },
      CobblerComments.authorField(),
      anchorField,
      textarea,
      el("div", { class: "comment-actions" }, el("button", { type: "submit", class: "small-btn" }, "Comment")));

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;

      let anchor = null;
      if (kind === "image" && C.pendingPin) anchor = { ...C.pendingPin };
      if (pageInput && Number(pageInput.value) >= 1) anchor = { page: Math.floor(Number(pageInput.value)) };
      if (timeBox?.checked && C.media) anchor = { time: Math.round(C.media.currentTime * 10) / 10 };

      const thread = CobblerComments.createThread(text, anchor ? { anchor } : {});
      file.comments.push(thread);
      C.save();
      C.pendingPin = null;
      renderComposer(file);
      C.threads.render();
      C.threads.select(thread.id);
      renderPins();
      renderFiles();
    });

    $1(".critique-composer").replaceChildren(form);
  }


  /* ---------- The comment list ---------- */

  function labelFor(file, thread) {
    const a = thread.anchor;
    if (!a) return null;
    if (a.x != null) return `#${pinNumber(file, thread)}`;
    if (a.page != null) return `p. ${a.page}`;
    if (a.time != null) return formatClock(a.time);
    return null;
  }

  // Clicking a comment's label shows the spot, page or moment it points to
  function showAnchor(file, thread) {
    const a = thread.anchor;
    if (a.x != null) {
      renderPins();
      const pin = $1(".critique-pin.is-selected");
      pin?.scrollIntoView({ block: "center", behavior: "smooth" });
      pin?.classList.add("is-flashing");
      setTimeout(() => pin?.classList.remove("is-flashing"), 1200);
    }
    if (a.page != null && C.media?.tagName === "IFRAME") {
      C.media.src = `${C.urls.get(file.blob)}#page=${a.page}`;
    }
    if (a.time != null && C.media?.currentTime != null) {
      C.media.currentTime = a.time;
      C.media.focus();
    }
  }

  function mountThreads(file) {
    C.threads = CobblerComments.mount($1(".critique-threads"), {
      getThreads: () => file.comments,
      save: () => C.save(),
      showResolved: () => C.showResolved,
      emptyText: "No comments on this file yet.",
      label: (thread) => labelFor(file, thread),
      onLabelClick: (thread) => { C.threads.select(thread.id); showAnchor(file, thread); },
      onSelect: () => renderPins(),
      onChange: () => { renderPins(); renderFiles(); },
    });
  }


  /* ---------- Let zine-planner.js use the Critique tab ---------- */
  window.ZineCritique = { mount, unmount };
})();
