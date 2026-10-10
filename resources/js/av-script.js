/* =========================================================
   av-script.js — the A/V Script page
   ---------------------------------------------------------
   Shows a paper edit (from Media & Transcripts › Text Edit)
   as a two-column script:
     VIDEO                                  AUDIO
     what we see: soundbite source,         what we hear: soundbite
     B-roll, titles, storyboard frames      quotes, narration
   Sections become headings across both columns.

   Each row's "what we see" note can be typed here (saved on the
   block as `visual`). Storyboard frames linked to a block (in the
   Storyboarder) show as thumbnails in its video cell.

   Save as Markdown (.md, a table), plain text (.txt, two columns), or
   PDF: a Courier New script layout, through the browser's print window
   ("Save as PDF"), which uses the Courier New installed on the computer.

   Needs projects-core.js, media-core.js, file-store.js, sketch-core.js.
   ========================================================= */
(() => {

  if (!window.Projects || !window.MediaCore) {
    console.error("av-script.js: load projects-core.js and media-core.js first.");
    return;
  }

  const M = window.MediaCore;
  const $ = (id) => document.getElementById(id);
  const EDIT_KEY = `textEditCurrent:${Projects.activeId()}`;   // same "open edit" as Text Edit


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "script";

  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  /* =========================================================
     DATA
     ========================================================= */

  const media = M.loadMedia();
  const edits = M.loadEdits();
  let editId = (() => { try { return localStorage.getItem(EDIT_KEY); } catch { return null; } })();

  const currentEdit = () => edits.find(e => e.id === editId) || edits[0] || null;
  const saveEdits = () => Projects.setData("edits", edits);

  /* Storyboard frames linked to a block: [{ board, frame, index }] */
  function framesFor(blockId) {
    const boards = Projects.getData("storyboards", []);
    if (!Array.isArray(boards)) return [];
    return boards.flatMap(board => (board.frames || [])
      .map((frame, index) => ({ board, frame, index }))
      .filter(({ frame }) => frame.blockRef?.blockId === blockId));
  }
  const ratioOf = (board) => ({ "16:9": 16 / 9, "2.39:1": 2.39, "1.85:1": 1.85, "4:3": 4 / 3, "1:1": 1, "4:5": 0.8, "9:16": 9 / 16 })[board.aspect] || 16 / 9;


  /* =========================================================
     BUILDING THE SCRIPT (one row per block)
     ========================================================= */

  /* Each row: { kind, time, video: [lines], audio: [lines], heading, block } */
  function scriptRows(edit) {
    let clock = 0;
    return edit.blocks.map(block => {
      const start = clock;
      clock += M.blockSeconds(block);
      const time = M.formatDuration(start);
      const visual = (block.visual || "").trim();

      if (block.kind === "section") return { kind: "section", heading: block.text.trim() || "Untitled section", block };

      if (block.kind === "soundbite") {
        const src = M.sourceOf(media, block);
        const who = src.transcript ? M.speakerName(src.transcript, block.speaker) : (block.speakerName || "Unknown");
        return {
          kind: "soundbite", time, block,
          video: [`SOT: ${who}`, `${src.clipName} ${M.toTimecode(src.sourceIn, src.fps)}–${M.toTimecode(src.sourceOut, src.fps)}`, visual].filter(Boolean),
          audio: [`${who.toUpperCase()}: “${block.text.trim()}”`],
        };
      }
      if (block.kind === "narration") {
        return { kind: "narration", time, block,
          video: [visual || "(Cover with B-roll)"],
          audio: [`NARRATION: ${block.text.trim()}`] };
      }
      if (block.kind === "broll") {
        return { kind: "broll", time, block,
          video: [`B-ROLL: ${block.text.trim() || "(to be decided)"}`, visual].filter(Boolean),
          audio: ["(Natural sound)"] };
      }
      return { kind: "title", time, block,
        video: [`TITLE: ${block.text.trim()}`, visual].filter(Boolean),
        audio: ["—"] };
    });
  }


  /* =========================================================
     THE PAGE
     ========================================================= */

  function render() {
    const edit = currentEdit();
    const select = $("av-edit");
    select.replaceChildren(...edits.map(e => el("option", { value: e.id }, e.name)));
    ["av-md", "av-txt", "av-pdf"].forEach(id => { $(id).disabled = !edit?.blocks.length; });

    if (!edit) {
      select.hidden = true;
      $("av-summary").textContent = "";
      $("av-script").replaceChildren(el("p", { class: "media-empty" },
        "No edits yet. Build one on ", el("a", { href: "media-and-transcripts.html#edit" }, "Media & Transcripts › Text Edit"),
        " and it appears here as a two-column script."));
      return;
    }
    select.hidden = false;
    select.value = edit.id;
    const total = M.runningTimes(media, edit.blocks).total;
    $("av-summary").textContent = `${edit.blocks.length} block${edit.blocks.length === 1 ? "" : "s"} · runs ${M.formatDuration(total)}`;

    const rows = scriptRows(edit);
    if (!rows.length) {
      $("av-script").replaceChildren(el("p", { class: "media-empty" }, "This edit is empty."));
      return;
    }

    const body = rows.map(row => {
      if (row.kind === "section") {
        return el("tr", { class: "av-section" }, el("th", { colspan: "3", scope: "rowgroup" }, row.heading));
      }

      // What we see: typed note, plus linked storyboard frames
      const note = el("textarea", { class: "av-visual", rows: "2", "aria-label": "What we see",
                                    placeholder: row.kind === "narration" ? "What we see during this narration" : "Add notes on what we see" });
      note.value = row.block.visual || "";
      note.addEventListener("input", () => { row.block.visual = note.value; saveEdits(); });

      const linked = framesFor(row.block.id);
      const thumbs = linked.length > 0 && el("div", { class: "av-frames" }, linked.map(({ board, frame, index }) =>
        el("a", { class: "av-frame", href: `storyboarder.html#board=${encodeURIComponent(board.id)}&frame=${encodeURIComponent(frame.id)}`,
                  title: `${board.name}, shot ${index + 1}` },
          window.Sketch ? Sketch.preview(frame, ratioOf(board), { image: frame.image }) : null,
          el("span", {}, `Shot ${index + 1}${frame.shot ? ` · ${frame.shot}` : ""}`))));

      const fixed = row.video.filter(line => line !== (row.block.visual || "").trim() && line !== "(Cover with B-roll)");
      return el("tr", { class: `av-row av-row--${row.kind}` },
        el("td", { class: "av-time" }, row.time),
        el("td", { class: "av-video" }, fixed.map(line => el("p", {}, line)), thumbs, note),
        el("td", { class: "av-audio" }, row.audio.map(line => el("p", {}, line))));
    });

    $("av-script").replaceChildren(el("table", { class: "av-table" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col", class: "av-time" }, "Time"), el("th", { scope: "col" }, "Video"), el("th", { scope: "col" }, "Audio"))),
      el("tbody", {}, body)));
  }


  /* =========================================================
     SAVING AS .md OR .txt
     ========================================================= */

  function toMarkdown(edit) {
    const cell = (lines) => lines.join("<br>").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
    const lines = [`# ${edit.name}`, "", `*${Projects.activeName()} · runs ${M.formatDuration(M.runningTimes(media, edit.blocks).total)}*`, ""];
    let table = false;
    scriptRows(edit).forEach(row => {
      if (row.kind === "section") {
        lines.push("", `## ${row.heading}`, "");
        table = false;
        return;
      }
      if (!table) { lines.push("| Time | Video | Audio |", "| --- | --- | --- |"); table = true; }
      lines.push(`| ${row.time} | ${cell(row.video)} | ${cell(row.audio)} |`);
    });
    return lines.join("\n") + "\n";
  }

  /* Wraps text to a width, for the two plain-text columns */
  function wrap(text, width) {
    const out = [];
    String(text).split("\n").forEach(paragraph => {
      let line = "";
      paragraph.split(/\s+/).filter(Boolean).forEach(word => {
        while (word.length > width) { out.push(word.slice(0, width)); word = word.slice(width); }
        if ((line + " " + word).trim().length > width) { out.push(line); line = word; }
        else line = (line + " " + word).trim();
      });
      out.push(line);
    });
    return out;
  }

  function toText(edit) {
    const W = 38;   // each column's width
    const rule = "-".repeat(W * 2 + 11);
    const lines = [edit.name.toUpperCase(), `${Projects.activeName()} · runs ${M.formatDuration(M.runningTimes(media, edit.blocks).total)}`, "",
                   `${"TIME".padEnd(6)} ${"VIDEO".padEnd(W)}  |  AUDIO`, rule];
    scriptRows(edit).forEach(row => {
      if (row.kind === "section") { lines.push("", `== ${row.heading.toUpperCase()} ==`, ""); return; }
      const video = row.video.flatMap(l => wrap(l, W));
      const audio = row.audio.flatMap(l => wrap(l, W));
      for (let i = 0; i < Math.max(video.length, audio.length); i++) {
        lines.push(`${(i === 0 ? row.time : "").padEnd(6)} ${(video[i] || "").padEnd(W)}  |  ${audio[i] || ""}`.trimEnd());
      }
      lines.push("");
    });
    return lines.join("\r\n");
  }


  /* ---------- PDF: a print layout in Courier New ---------- */

  function buildPrintSheet(edit) {
    const total = M.runningTimes(media, edit.blocks).total;
    const rows = scriptRows(edit).map(row => row.kind === "section"
      ? el("tr", { class: "av-print-section" }, el("td", { colspan: "3" }, row.heading.toUpperCase()))
      : el("tr", {},
          el("td", { class: "av-print-time" }, row.time),
          el("td", {}, row.video.map(line => el("p", {}, line))),
          el("td", {}, row.audio.map(line => el("p", {}, line)))));

    $("av-print").replaceChildren(
      el("header", { class: "av-print-head" },
        el("p", { class: "av-print-title" }, edit.name.toUpperCase()),
        el("p", {}, Projects.activeName()),
        el("p", {}, `Running time ${M.formatDuration(total)} · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`)),
      el("table", { class: "av-print-table" },
        el("thead", {}, el("tr", {}, el("th", { class: "av-print-time" }, "TIME"), el("th", {}, "VIDEO"), el("th", {}, "AUDIO"))),
        el("tbody", {}, rows)));
  }

  function savePDF() {
    const edit = currentEdit();
    if (!edit) return;
    buildPrintSheet(edit);
    const title = document.title;
    document.title = `${edit.name} – A/V script`;   // the suggested PDF file name
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      document.title = title;
    }));
  }
  window.addEventListener("afterprint", () => $("av-print").replaceChildren());


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    $("av-edit").addEventListener("change", (event) => {
      editId = event.target.value;
      try { localStorage.setItem(EDIT_KEY, editId); } catch {}
      render();
    });
    $("av-md").addEventListener("click", () => {
      const edit = currentEdit();
      download(toMarkdown(edit), `${slug(edit.name)}-av-script.md`, "text/markdown");
    });
    $("av-pdf").addEventListener("click", savePDF);
    $("av-txt").addEventListener("click", () => {
      const edit = currentEdit();
      download(toText(edit), `${slug(edit.name)}-av-script.txt`, "text/plain");
    });
    render();
  });

  window.AVScript = { toMarkdown, toText, scriptRows };
})();
