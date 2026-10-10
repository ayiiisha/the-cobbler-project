/* =========================================================
   text-edit.js — the Text Edit tab (a paper edit)
   ---------------------------------------------------------
   The transcript sits beside your paper edit:
     • Select words in the transcript, then "Add soundbite"
     • Click a paragraph's timecode to take the whole paragraph,
       or drag the timecode across into the edit
     • Add narration, B-roll, titles and sections
     • Drag blocks (by ⠿) or use ↑ ↓ to reorder
     • Trim a soundbite by typing its In and Out timecode
   Lines already used in this edit are underlined in the transcript.
   The panel shows the running time, in total and per speaker.

   New blocks go after the highlighted block (click a block to
   highlight it), or at the end.

   Needs media-core.js and media.js (window.MediaPage).
   ========================================================= */
(() => {

  const M = window.MediaCore;
  const Page = window.MediaPage;
  if (!M || !Page) return;
  const { el, plural } = Page;


  /* =========================================================
     STATE
     ========================================================= */

  const editKey = () => `textEditCurrent:${Projects.activeId()}`;   // remembers the open edit (this browser; a function because the project can change without a reload)

  const TE = {
    panel: null,
    editId: (() => { try { return localStorage.getItem(editKey()); } catch { return null; } })(),
    transcriptId: null,
    selectedBlockId: null,
    drag: null,          // { type: "segment", transcriptId, index } or { type: "block", id }
  };

  const $1 = (selector) => TE.panel.querySelector(selector);
  const media = () => Page.media;

  function currentEdit() {
    let edit = Page.edits.find(e => e.id === TE.editId);
    if (!edit) {
      edit = Page.edits[0];
      if (!edit) {
        edit = { id: M.newId("e"), name: "Edit 1", created: Date.now(), updated: Date.now(), blocks: [] };
        Page.edits.push(edit);
        Page.saveEdits();
      }
      setEdit(edit.id);
    }
    return edit;
  }

  function setEdit(id) {
    TE.editId = id;
    TE.selectedBlockId = null;
    try { localStorage.setItem(editKey(), id); } catch {}
  }

  function saveEdit() {
    currentEdit().updated = Date.now();
    Page.saveEdits();
  }

  const currentTranscript = () => media().transcripts.find(t => t.id === TE.transcriptId) || null;

  // Seconds for display: "4.5s", "1:23"
  const shortTime = (s) => s < 60 ? `${Math.round(s * 10) / 10}s` : M.formatDuration(s);


  /* =========================================================
     LAYOUT
     ========================================================= */

  function render(panel, options = {}) {
    TE.panel = panel;
    if (options.transcriptId) TE.transcriptId = options.transcriptId;
    if (!currentTranscript()) TE.transcriptId = media().transcripts[0]?.id || null;

    const addButtons = ["narration", "broll", "title", "section"].map(kind =>
      el("button", { type: "button", class: "small-btn", onclick: () => addBlock(M.newBlock(kind), { focus: true }) }, `+ ${M.KINDS[kind].name}`));

    panel.replaceChildren(
      el("div", { class: "sketch-nav te-bar" },
        el("label", { class: "tool-group" }, "Edit", el("select", { class: "team-select te-edit-select", "aria-label": "Paper edit" })),
        el("div", { class: "tool-group" },
          el("button", { type: "button", class: "small-btn", onclick: newEdit }, "New"),
          el("button", { type: "button", class: "small-btn", onclick: renameEdit }, "Rename"),
          el("button", { type: "button", class: "small-btn", onclick: duplicateEdit }, "Duplicate"),
          el("button", { type: "button", class: "small-btn", onclick: deleteEdit }, "Delete")),
        // "Claim": tells collaborators you're working on this edit (share.js)
        el("span", { class: "tool-group te-claim" }),
        el("label", { class: "tool-group" }, "Structure",
          el("select", { class: "team-select te-structure", "aria-label": "Add a starter structure" },
            el("option", { value: "" }, "Add a starter structure…"),
            Object.entries(M.STRUCTURES).map(([id, s]) => el("option", { value: id }, s.name))),
          el("select", { class: "team-select te-structure-remove", "aria-label": "Remove sections" })),
        el("p", { class: "te-undo", role: "status", hidden: true })),

      el("div", { class: "te-layout" },
        el("section", { class: "te-pane te-transcript", "aria-label": "Transcript" },
          el("div", { class: "te-pane-head" },
            el("select", { class: "team-select te-transcript-select", "aria-label": "Transcript" }),
            el("button", { type: "button", class: "small-btn te-add-selection", disabled: true, onclick: addSelection }, "Add selection as soundbite")),
          el("p", { class: "te-tip" }, "Select words, then add them. Click a timecode to take the whole paragraph, or drag it into the edit."),
          el("div", { class: "te-paragraphs", tabindex: "-1" })),

        el("section", { class: "te-pane te-edit", "aria-label": "Paper edit" },
          el("div", { class: "te-times" }),
          el("div", { class: "te-add" }, addButtons),
          el("ol", { class: "te-blocks", "aria-label": "Blocks in this edit" }))),

      el("button", { type: "button", class: "te-float small-btn", hidden: true, onmousedown: (e) => e.preventDefault(), onclick: addSelection }, "+ Add soundbite"));

    $1(".te-edit-select").addEventListener("change", (event) => { setEdit(event.target.value); renderAll(); });
    $1(".te-transcript-select").addEventListener("change", (event) => { TE.transcriptId = event.target.value; renderTranscript(); });
    $1(".te-structure").addEventListener("change", (event) => { addStructure(event.target.value); event.target.value = ""; });
    $1(".te-structure-remove").addEventListener("change", (event) => { removeSections(event.target.value); event.target.value = ""; });
    setUpDropZone($1(".te-blocks"));

    renderAll();
    if (options.segment != null) revealSegment(options.segment);
  }

  function renderAll() {
    const edit = currentEdit();
    const editSelect = $1(".te-edit-select");
    editSelect.replaceChildren(...Page.edits.map(e => el("option", { value: e.id }, e.name)));
    editSelect.value = edit.id;
    $1(".te-claim")?.replaceChildren(window.ProjectShare?.claimButton ? ProjectShare.claimButton(edit.id, edit.name) : "");
    renderTranscript();
    renderBlocks();
  }


  /* =========================================================
     THE TRANSCRIPT
     ========================================================= */

  function renderTranscript() {
    const select = $1(".te-transcript-select");
    const box = $1(".te-paragraphs");
    select.replaceChildren(...media().transcripts.map(t => el("option", { value: t.id }, t.title)));

    const transcript = currentTranscript();
    if (!transcript) {
      select.hidden = true;
      box.replaceChildren(el("p", { class: "media-empty" }, "No transcripts yet. ",
        el("button", { type: "button", class: "comment-action", onclick: () => Page.show("media") }, "Import or paste one"),
        " on the Media & Transcripts tab."));
      return;
    }
    select.hidden = false;
    select.value = transcript.id;

    const clip = M.clipFor(media(), transcript);
    const offset = clip?.tcStart || 0;
    const fps = clip?.fps || media().fps;
    const used = usedRanges(transcript);

    box.replaceChildren(...transcript.segments.map((s, i) => {
      const tc = el("button", {
        type: "button", class: "te-tc", draggable: "true",
        title: "Add this paragraph to the edit, or drag it across",
        onclick: () => addBlock(soundbiteFrom(transcript, i, 0, i, s.text.length)),
      }, M.toTimecode(offset + s.start, fps));
      tc.addEventListener("dragstart", (event) => {
        TE.drag = { type: "segment", transcriptId: transcript.id, index: i };
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", s.text);
      });
      tc.addEventListener("dragend", () => { TE.drag = null; clearDropMarker(); });

      const who = el("span", { class: "te-speaker" }, M.speakerName(transcript, s.speaker));
      who.style.setProperty("--c", Page.speakerColor(transcript, s.speaker));

      return el("div", { class: "te-para", dataset: { index: String(i) } },
        el("div", { class: "te-para-head" }, tc, who),
        el("p", { class: "te-text" }, textWithUsed(s.text, used[i])));
    }));
  }

  /* Paragraph text with the parts already in the edit wrapped in <span class="te-used"> */
  function textWithUsed(text, ranges = []) {
    if (!ranges.length) return [text];
    const parts = [];
    let at = 0;
    ranges.forEach(([a, b]) => {
      if (a > at) parts.push(text.slice(at, a));
      parts.push(el("span", { class: "te-used", title: "Already in this edit" }, text.slice(Math.max(a, at), b)));
      at = Math.max(at, b);
    });
    if (at < text.length) parts.push(text.slice(at));
    return parts;
  }

  /* For each paragraph: which character ranges are already used by soundbites in this edit */
  function usedRanges(transcript) {
    const ranges = {};
    currentEdit().blocks.filter(b => b.kind === "soundbite" && b.transcriptId === transcript.id).forEach(b => {
      transcript.segments.forEach((s, i) => {
        if (b.out <= s.start || b.in >= s.end) return;
        // Nudged a millisecond inwards and snapped to whole words, so rounding
        // can't shift the underline by a letter
        const a = toWordStart(s.text, M.offsetAt(s, b.in + 0.001));
        const z = toWordEnd(s.text, Math.max(a, M.offsetAt(s, b.out - 0.001)));
        if (z > a) (ranges[i] ||= []).push([a, z]);
      });
    });
    // Sort and join overlapping ranges
    for (const i of Object.keys(ranges)) {
      const merged = [];
      ranges[i].sort((x, y) => x[0] - y[0]).forEach(r => {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
      });
      ranges[i] = merged;
    }
    return ranges;
  }

  /* Scrolls to a paragraph and flashes it */
  function revealSegment(index) {
    const para = $1(`.te-para[data-index="${index}"]`);
    if (!para) return;
    para.scrollIntoView({ block: "center", behavior: "smooth" });
    para.classList.remove("comment-flash");
    void para.offsetWidth;
    para.classList.add("comment-flash");
  }


  /* ---------- Selecting words → a soundbite ---------- */

  // Character offset of (node, offset) inside a paragraph's text
  function offsetIn(textEl, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(textEl);
    try { range.setEnd(node, offset); } catch { return 0; }
    return range.toString().length;
  }

  /* The current selection in the transcript, as paragraph + character positions */
  function readSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !TE.panel) return null;
    const box = $1(".te-paragraphs");
    const range = selection.getRangeAt(0);
    if (!box.contains(range.startContainer) || !box.contains(range.endContainer)) return null;

    const startPara = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement).closest(".te-para");
    const endPara = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement).closest(".te-para");
    if (!startPara || !endPara) return null;

    const startText = startPara.querySelector(".te-text");
    const endText = endPara.querySelector(".te-text");
    const a = startText.contains(range.startContainer) ? offsetIn(startText, range.startContainer, range.startOffset) : 0;
    const z = endText.contains(range.endContainer) ? offsetIn(endText, range.endContainer, range.endOffset) : endText.textContent.length;
    const from = Number(startPara.dataset.index), to = Number(endPara.dataset.index);
    if (from === to && z - a < 1) return null;
    return { from, a, to, z, rect: range.getBoundingClientRect() };
  }

  // Widens a cut to whole words
  function toWordStart(text, i) { while (i > 0 && /\S/.test(text[i - 1])) i--; return i; }
  function toWordEnd(text, i) { while (i < text.length && /\S/.test(text[i])) i++; return i; }

  /* A soundbite from paragraph `from` (character a) to paragraph `to` (character z) */
  function soundbiteFrom(transcript, from, a, to, z) {
    const segs = transcript.segments;
    a = toWordStart(segs[from].text, a);
    z = toWordEnd(segs[to].text, z);
    const parts = [];
    for (let i = from; i <= to; i++) {
      const t = segs[i].text;
      parts.push(t.slice(i === from ? a : 0, i === to ? z : t.length).trim());
    }
    const clip = M.clipFor(media(), transcript);
    return M.newBlock("soundbite", {
      text: parts.filter(Boolean).join(" "),
      transcriptId: transcript.id,
      speaker: segs[from].speaker,
      speakerName: M.speakerName(transcript, segs[from].speaker),
      clipName: clip?.name || transcript.title,
      in: Math.round(M.timeAt(segs[from], a) * 1000) / 1000,
      out: Math.round(M.timeAt(segs[to], z) * 1000) / 1000,
    });
  }

  function addSelection() {
    const sel = readSelection();
    const transcript = currentTranscript();
    if (!sel || !transcript) return;
    addBlock(soundbiteFrom(transcript, sel.from, sel.a, sel.to, sel.z));
    window.getSelection().removeAllRanges();
    updateSelectionButtons();
  }

  /* Shows "+ Add soundbite" next to selected transcript text */
  function updateSelectionButtons() {
    if (!TE.panel || TE.panel.hidden) return;
    const sel = readSelection();
    const float = $1(".te-float");
    $1(".te-add-selection").disabled = !sel;
    float.hidden = !sel;
    if (sel) {
      float.style.left = `${Math.min(window.innerWidth - 180, Math.max(8, sel.rect.right - 60))}px`;
      float.style.top = `${Math.min(window.innerHeight - 50, sel.rect.bottom + 8)}px`;
    }
  }
  document.addEventListener("selectionchange", updateSelectionButtons);
  window.addEventListener("scroll", () => { if (TE.panel && !$1(".te-float").hidden) updateSelectionButtons(); }, { passive: true });


  /* =========================================================
     THE PAPER EDIT (blocks)
     ========================================================= */

  /* Adds a block after the highlighted one (or at the end) */
  function addBlock(block, { at = null, focus = false } = {}) {
    const blocks = currentEdit().blocks;
    let index = at;
    if (index == null) {
      const selected = blocks.findIndex(b => b.id === TE.selectedBlockId);
      index = selected >= 0 ? selected + 1 : blocks.length;
    }
    blocks.splice(index, 0, block);
    TE.selectedBlockId = block.id;
    saveEdit();
    renderBlocks();
    renderTranscript();
    const node = $1(`.te-block[data-id="${block.id}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (focus) node?.querySelector("textarea, input")?.focus();
  }

  function renderBlocks() {
    const list = $1(".te-blocks");
    const blocks = currentEdit().blocks;
    renderTimes();
    renderRemoveMenu();
    if (!blocks.length) {
      list.replaceChildren(el("li", { class: "te-empty" },
        "Your edit is empty. Select words in the transcript and add them, drag a paragraph's timecode here, add narration and B-roll, or start from a structure."));
      return;
    }
    list.replaceChildren(...blocks.map((b, i) => blockView(b, i, blocks.length)));
  }

  function blockView(block, i, count) {
    const edit = currentEdit();
    const time = el("span", { class: "te-block-time" }, block.kind === "section" ? "" : shortTime(M.blockSeconds(block)));
    const refreshTime = () => {
      time.textContent = block.kind === "section" ? "" : shortTime(M.blockSeconds(block));
      renderTimes();
    };

    const move = (to) => {
      edit.blocks.splice(i, 1);
      edit.blocks.splice(to, 0, block);
      saveEdit();
      renderBlocks();
      $1(`.te-block[data-id="${block.id}"] .te-block-move-${to < i ? "up" : "down"}`)?.focus();
    };

    const handle = el("span", { class: "te-drag", title: "Drag to reorder", "aria-hidden": "true" }, "⠿");
    const node = el("li", {
      class: `te-block te-block--${block.kind}${block.id === TE.selectedBlockId ? " is-selected" : ""}`,
      dataset: { id: block.id },
    },
      el("div", { class: "te-block-head" },
        handle,
        el("span", { class: "te-kind" }, M.KINDS[block.kind].name),
        time,
        el("div", { class: "te-block-actions" },
          el("button", { type: "button", class: "comment-action te-block-move-up", "aria-label": "Move up", disabled: i === 0, onclick: () => move(i - 1) }, "↑"),
          el("button", { type: "button", class: "comment-action te-block-move-down", "aria-label": "Move down", disabled: i === count - 1, onclick: () => move(i + 1) }, "↓"),
          el("button", { type: "button", class: "comment-action", onclick: () => {
            addBlock({ ...JSON.parse(JSON.stringify(block)), id: M.newId("k") }, { at: i + 1 });
          } }, "Duplicate"),
          el("button", { type: "button", class: "comment-action", onclick: () => {
            edit.blocks.splice(i, 1);
            if (TE.selectedBlockId === block.id) TE.selectedBlockId = null;
            saveEdit();
            renderBlocks();
            renderTranscript();
          } }, "Delete"))),
      blockBody(block, refreshTime));

    // Click a block to highlight it: new blocks then go after it
    node.addEventListener("click", (event) => {
      if (event.target.closest("button, input, textarea, select")) return;
      TE.selectedBlockId = TE.selectedBlockId === block.id ? null : block.id;
      $1(".te-blocks").querySelectorAll(".te-block").forEach(n => n.classList.toggle("is-selected", n.dataset.id === TE.selectedBlockId));
    });

    // Drag by the handle to reorder
    handle.addEventListener("pointerdown", () => { node.draggable = true; });
    node.addEventListener("dragstart", (event) => {
      TE.drag = { type: "block", id: block.id };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", block.text || M.KINDS[block.kind].name);
      node.classList.add("is-dragging");
    });
    node.addEventListener("dragend", () => {
      TE.drag = null;
      node.draggable = false;
      node.classList.remove("is-dragging");
      clearDropMarker();
    });
    return node;
  }

  /* The inside of a block, depending on its kind */
  function blockBody(block, refreshTime) {
    const update = (fields) => { Object.assign(block, fields); saveEdit(); refreshTime(); };

    if (block.kind === "soundbite") {
      const src = M.sourceOf(media(), block);
      const inBox = el("input", { class: "tc-input", "aria-label": "In timecode", value: M.toTimecode(src.sourceIn, src.fps) });
      const outBox = el("input", { class: "tc-input", "aria-label": "Out timecode", value: M.toTimecode(src.sourceOut, src.fps) });
      const quote = el("blockquote", { class: "te-quote" }, block.text);
      const offset = src.clip?.tcStart || 0;

      const trim = () => {
        const a = M.fromTimecode(inBox.value, src.fps), z = M.fromTimecode(outBox.value, src.fps);
        const ok = a != null && z != null && z - offset > a - offset && a >= offset;
        inBox.setAttribute("aria-invalid", String(a == null || a < offset));
        outBox.setAttribute("aria-invalid", String(!ok));
        if (!ok) return;
        const fields = { in: a - offset, out: z - offset };
        if (src.transcript) fields.text = textBetween(src.transcript, fields.in, fields.out) || block.text;
        update(fields);
        quote.textContent = block.text;
        inBox.value = M.toTimecode(offset + block.in, src.fps);
        outBox.value = M.toTimecode(offset + block.out, src.fps);
        renderTranscript();
      };
      inBox.addEventListener("change", trim);
      outBox.addEventListener("change", trim);

      return el("div", { class: "te-block-body" },
        el("p", { class: "te-who" },
          el("strong", {}, src.transcript ? M.speakerName(src.transcript, block.speaker) : (block.speakerName || "Unknown")),
          ` · ${src.clipName}`,
          !src.transcript && el("span", { class: "transcript-warning" }, " · transcript deleted")),
        quote,
        el("div", { class: "te-trim" },
          el("label", {}, "In ", inBox),
          el("label", {}, "Out ", outBox),
          src.transcript && el("button", { type: "button", class: "comment-action", onclick: () => {
            TE.transcriptId = src.transcript.id;
            renderTranscript();
            const index = src.transcript.segments.findIndex(s => s.end > block.in);
            revealSegment(Math.max(0, index));
          } }, "Show in transcript")));
    }

    if (block.kind === "section") {
      const input = el("input", { class: "te-section-input", "aria-label": "Section name", placeholder: "Section name", value: block.text });
      input.addEventListener("input", () => update({ text: input.value }));
      return el("div", { class: "te-block-body" }, input);
    }

    // Narration, B-roll, title: text + seconds (blank = automatic)
    const placeholders = {
      narration: "Narration or voice-over script",
      broll: "What we see (shots, archive, graphics)",
      title: "On-screen text",
    };
    const text = block.kind === "title"
      ? el("input", { "aria-label": "Title text", placeholder: placeholders.title, value: block.text })
      : el("textarea", { rows: "2", "aria-label": `${M.KINDS[block.kind].name} text`, placeholder: placeholders[block.kind] });
    text.value = block.text;
    const seconds = el("input", {
      type: "number", min: "0", step: "0.5", class: "te-seconds", "aria-label": "Seconds",
      placeholder: block.kind === "narration" ? "auto" : String(M.KINDS[block.kind].defaultSeconds),
      value: block.seconds ?? "",
    });
    text.addEventListener("input", () => update({ text: text.value }));
    seconds.addEventListener("input", () => update({ seconds: seconds.value === "" ? null : Number(seconds.value) }));

    return el("div", { class: "te-block-body" }, text,
      el("label", { class: "te-seconds-label" }, "Seconds ", seconds,
        block.kind === "narration" && el("span", { class: "media-muted" }, " (blank: timed from the word count)")));
  }

  /* The transcript's words between two times (for trimmed soundbites) */
  function textBetween(transcript, a, z) {
    return transcript.segments
      .filter(s => s.end > a && s.start < z)
      .map(s => {
        const from = toWordStart(s.text, M.offsetAt(s, a));
        const to = toWordEnd(s.text, M.offsetAt(s, z));
        return s.text.slice(from, to).trim();
      })
      .filter(Boolean)
      .join(" ");
  }


  /* ---------- Running time ---------- */

  function renderTimes() {
    const { total, per } = M.runningTimes(media(), currentEdit().blocks);
    const box = $1(".te-times");
    box.replaceChildren(
      el("p", { class: "te-total" }, el("strong", {}, M.formatDuration(total)), " running time",
        el("span", { class: "media-muted" }, ` · ${plural(currentEdit().blocks.length, "block")}`)),
      !per.length ? "" : el("ul", { class: "te-per" }, per.map(([label, seconds]) => {
        const bar = el("span", { class: "te-per-bar", "aria-hidden": "true" });
        bar.style.width = `${total ? (seconds / total) * 100 : 0}%`;
        return el("li", {}, el("span", { class: "te-per-label" }, label), bar,
          el("span", { class: "te-per-time" }, `${M.formatDuration(seconds)} · ${Math.round(total ? seconds / total * 100 : 0)}%`));
      })));
  }


  /* ---------- Dragging into and around the edit ---------- */

  function clearDropMarker() {
    TE.panel?.querySelectorAll(".drop-before, .drop-after").forEach(n => n.classList.remove("drop-before", "drop-after"));
  }

  // Where a drop at height `y` lands: the index to insert at
  function dropIndex(list, y) {
    const items = [...list.querySelectorAll(".te-block")];
    const at = items.findIndex(n => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return { index: at < 0 ? items.length : at, items };
  }

  function setUpDropZone(list) {
    list.addEventListener("dragover", (event) => {
      if (!TE.drag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = TE.drag.type === "block" ? "move" : "copy";
      clearDropMarker();
      const { index, items } = dropIndex(list, event.clientY);
      if (items[index]) items[index].classList.add("drop-before");
      else items[items.length - 1]?.classList.add("drop-after");
    });
    list.addEventListener("dragleave", (event) => { if (!list.contains(event.relatedTarget)) clearDropMarker(); });
    list.addEventListener("drop", (event) => {
      if (!TE.drag) return;
      event.preventDefault();
      clearDropMarker();
      const { index } = dropIndex(list, event.clientY);
      const blocks = currentEdit().blocks;

      if (TE.drag.type === "segment") {
        const transcript = media().transcripts.find(t => t.id === TE.drag.transcriptId);
        if (transcript) {
          const s = transcript.segments[TE.drag.index];
          addBlock(soundbiteFrom(transcript, TE.drag.index, 0, TE.drag.index, s.text.length), { at: index });
        }
      } else {
        const from = blocks.findIndex(b => b.id === TE.drag.id);
        if (from < 0) return;
        const [block] = blocks.splice(from, 1);
        blocks.splice(from < index ? index - 1 : index, 0, block);
        saveEdit();
        renderBlocks();
      }
      TE.drag = null;
    });
  }


  /* =========================================================
     EDITS AND STRUCTURES
     ========================================================= */

  function newEdit() {
    const name = prompt("Name for the new edit:", `Edit ${Page.edits.length + 1}`);
    if (!name?.trim()) return;
    const edit = { id: M.newId("e"), name: name.trim(), created: Date.now(), updated: Date.now(), blocks: [] };
    Page.edits.push(edit);
    Page.saveEdits();
    setEdit(edit.id);
    renderAll();
  }

  function renameEdit() {
    const edit = currentEdit();
    const name = prompt("Rename this edit:", edit.name);
    if (!name?.trim()) return;
    edit.name = name.trim();
    saveEdit();
    renderAll();
  }

  function duplicateEdit() {
    const edit = currentEdit();
    const copy = JSON.parse(JSON.stringify(edit));
    Object.assign(copy, { id: M.newId("e"), name: `${edit.name} (copy)`, created: Date.now(), updated: Date.now() });
    copy.blocks.forEach(b => { b.id = M.newId("k"); });
    Page.edits.push(copy);
    Page.saveEdits();
    setEdit(copy.id);
    renderAll();
  }

  function deleteEdit() {
    const edit = currentEdit();
    if (!confirm(`Delete the edit “${edit.name}” (${plural(edit.blocks.length, "block")})? This can't be undone.`)) return;
    Page.edits = Page.edits.filter(e => e !== edit);
    Page.saveEdits();
    setEdit(Page.edits[0]?.id || null);
    renderAll();
  }

  function addStructure(id) {
    const structure = M.STRUCTURES[id];
    if (!structure) return;
    const edit = currentEdit();
    if (edit.blocks.length && !confirm(`Add the ${structure.name} sections to the end of “${edit.name}”?`)) return;
    // Tagged with the structure, so the whole set can be removed again in one go
    structure.sections.forEach(name => edit.blocks.push(M.newBlock("section", { text: name, fromStructure: id })));
    TE.selectedBlockId = null;
    saveEdit();
    renderBlocks();
  }

  /* ---------- Removing structure sections ----------
     Only section headings are removed; soundbites, narration and the
     rest stay where they are. One step back is possible with Undo. */

  // Which starter structure a section came from (older edits: matched by name)
  function structureOf(block) {
    if (block.kind !== "section") return null;
    if (block.fromStructure) return block.fromStructure;
    return Object.keys(M.STRUCTURES).find(id => M.STRUCTURES[id].sections.includes(block.text)) || null;
  }

  // Sections with nothing under them (straight after another section, or at the end)
  function emptySections(blocks) {
    return blocks.filter((b, i) => b.kind === "section" && (i === blocks.length - 1 || blocks[i + 1].kind === "section"));
  }

  /* The "Remove sections…" menu: each structure in this edit, empty ones, all */
  function renderRemoveMenu() {
    const blocks = currentEdit().blocks;
    const sections = blocks.filter(b => b.kind === "section");
    const counts = {};
    sections.forEach(b => { const id = structureOf(b); if (id) counts[id] = (counts[id] || 0) + 1; });
    const empty = emptySections(blocks).length;

    const menu = $1(".te-structure-remove");
    menu.replaceChildren(...[
      el("option", { value: "" }, "Remove sections…"),
      ...Object.entries(counts).map(([id, n]) => el("option", { value: `structure:${id}` }, `${M.STRUCTURES[id].name} (${plural(n, "section")})`)),
      empty > 0 && el("option", { value: "empty" }, `Empty sections (${empty})`),
      sections.length > 0 && el("option", { value: "all" }, `All sections (${sections.length})`),
    ].filter(Boolean));
    menu.disabled = !sections.length;
  }

  function removeSections(choice) {
    if (!choice) return;
    const edit = currentEdit();
    let doomed;
    if (choice === "all") doomed = edit.blocks.filter(b => b.kind === "section");
    else if (choice === "empty") doomed = emptySections(edit.blocks);
    else {
      const id = choice.replace("structure:", "");
      doomed = edit.blocks.filter(b => structureOf(b) === id);
    }
    if (!doomed.length) return;

    const before = edit.blocks.slice();
    edit.blocks = edit.blocks.filter(b => !doomed.includes(b));
    if (doomed.some(b => b.id === TE.selectedBlockId)) TE.selectedBlockId = null;
    saveEdit();
    renderBlocks();

    // "Removed 3 sections. Undo"
    const note = $1(".te-undo");
    note.replaceChildren(`Removed ${plural(doomed.length, "section")}. `,
      el("button", { type: "button", class: "comment-action", onclick: () => {
        edit.blocks = before;
        saveEdit();
        renderBlocks();
        note.hidden = true;
      } }, "Undo"));
    note.hidden = false;
    clearTimeout(removeSections.timer);
    removeSections.timer = setTimeout(() => { note.hidden = true; }, 12000);
  }


  /* ---------- Hook into the page ---------- */
  Page.register("edit", { render });

  // After a switch to another project (media.js): that project's own open edit
  window.TextEdit = { reset() {
    try { TE.editId = localStorage.getItem(editKey()); } catch { TE.editId = null; }
    TE.transcriptId = null;
    TE.selectedBlockId = null;
    TE.drag = null;
  } };
})();
