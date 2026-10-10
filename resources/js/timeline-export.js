/* =========================================================
   timeline-export.js — the Export Timeline tab
   ---------------------------------------------------------
   Turns a paper edit into files an editor can open:
     • FCPXML (1.9)  Final Cut Pro, DaVinci Resolve
     • XML (xmeml)   Premiere Pro (also Resolve)
     • EDL (CMX3600) almost any editor
     • Resolve markers (.edl) coloured markers for DaVinci Resolve:
       soundbites, narration, B-roll, titles and sections, each in
       its own colour (MARKER_KINDS), imported onto the timeline
   Soundbites become clips at their source timecode. Narration,
   B-roll and titles become gaps (empty space) with a marker
   holding their text. Sections become markers on the next item.

   It's a round trip through files, not a live connection:
   export, import into the editor, and the editor relinks the
   clips by name (it asks you to find any it can't).

   Needs media-core.js and media.js (window.MediaPage).
   ========================================================= */
(() => {

  const M = window.MediaCore;
  const Page = window.MediaPage;
  if (!M || !Page) return;
  const { el, plural } = Page;

  const SIZES = {
    "1920x1080": "1920 × 1080 (HD)",
    "3840x2160": "3840 × 2160 (4K UHD)",
    "1280x720":  "1280 × 720",
    "1080x1920": "1080 × 1920 (vertical)",
    "1080x1080": "1080 × 1080 (square)",
  };


  /* Marker colours in Resolve, by kind of block (Resolve's own colour names) */
  const MARKER_KINDS = {
    section:   { name: "Sections",   color: "Red" },
    soundbite: { name: "Soundbites", color: "Blue" },
    narration: { name: "Narration",  color: "Green" },
    broll:     { name: "B-roll",     color: "Yellow" },
    title:     { name: "Titles",     color: "Purple" },
  };


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  // Makes text safe inside XML
  const xml = (text) => String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  const oneLine = (text, max = 200) => {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  };

  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "edit";

  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* FCPXML frame durations: a frame is num/den seconds */
  function frameDuration(fps) {
    return {
      23.976: [1001, 24000], 24: [100, 2400], 25: [100, 2500], 29.97: [1001, 30000],
      30: [100, 3000], 50: [100, 5000], 59.94: [1001, 60000], 60: [100, 6000],
    }[fps] || [100, Math.round(fps * 100)];
  }

  const ntsc = (fps) => [23.976, 29.97, 59.94].includes(fps);

  /* A file:// address for a clip (or a placeholder the editor will ask you to relink).
     `pathMap` { from, to } swaps the folder the clips were imported from for
     someone else's (from "Where everyone keeps the media" on the Media tab). */
  function fileUrl(clip, name, pathMap = null) {
    const path = clip?.path || "";
    if (pathMap?.from && pathMap.to) {
      const local = Page.localPath(path);
      if (local.startsWith(pathMap.from)) {
        const to = pathMap.to.replace(/\\/g, "/").replace(/\/?$/, "/");
        const mapped = to + local.slice(pathMap.from.length);
        if (/^[A-Za-z]:\//.test(mapped)) return "file:///" + encodeURI(mapped);
        return "file://" + encodeURI(mapped.startsWith("/") ? mapped : "/" + mapped);
      }
    }
    if (/^file:\/\//i.test(path)) return path;
    if (path.startsWith("/")) return "file://" + encodeURI(path);
    if (/^[A-Za-z]:[\\/]/.test(path)) return "file:///" + encodeURI(path.replace(/\\/g, "/"));
    return "file:///Missing%20media/" + encodeURIComponent(name);
  }


  /* =========================================================
     ASSEMBLING THE TIMELINE
     All positions are whole frames at the sequence frame rate.
     ========================================================= */

  function assemble(edit, settings) {
    const media = Page.media;
    const { fps } = settings;
    const toFrames = (seconds) => Math.round(seconds * fps);
    const start = toFrames(settings.start);

    const items = [];      // { type: "clip" | "gap", rec, length, markers, ... }
    const sources = new Map();   // clip name → { name, clip, firstFrame, lastFrame }
    let at = start;
    let pending = [];      // section names waiting for the next item

    edit.blocks.forEach(block => {
      if (block.kind === "section") {
        if (block.text.trim()) pending.push(`Section: ${block.text.trim()}`);
        return;
      }
      const src = block.kind === "soundbite" ? M.sourceOf(media, block) : null;
      // Soundbites: In and Out rounded to frames the same way as on screen, so the cut matches
      const length = src ? toFrames(src.sourceOut) - toFrames(src.sourceIn) : toFrames(M.blockSeconds(block));
      if (length <= 0) return;
      const markers = pending.map(name => ({ name, comment: "" }));
      pending = [];

      if (src) {
        const srcIn = toFrames(src.sourceIn);
        const clipStart = toFrames(src.clip?.tcStart || 0);
        const source = sources.get(src.clipName) || { name: src.clipName, clip: src.clip, tcStart: clipStart, lastFrame: 0 };
        source.lastFrame = Math.max(source.lastFrame, srcIn + length);
        sources.set(src.clipName, source);
        items.push({ type: "clip", rec: at, length, srcIn, source, block, markers,
                     label: `${src.transcript ? M.speakerName(src.transcript, block.speaker) : block.speakerName || ""}: ${oneLine(block.text, 80)}` });
      } else {
        const kind = M.KINDS[block.kind].name;
        markers.push({ name: `${kind}: ${oneLine(block.text, 60) || kind}`, comment: oneLine(block.text, 1000), length });
        items.push({ type: "gap", rec: at, length, kind, block, markers });
      }
      at += length;
    });

    // Sections at the very end become markers on a one-frame gap
    if (pending.length) {
      items.push({ type: "gap", rec: at, length: 1, kind: "End", markers: pending.map(name => ({ name, comment: "" })) });
      at += 1;
    }

    // Each source's length: its own, or long enough for every use of it
    sources.forEach(s => {
      const own = s.clip?.duration ? toFrames(s.clip.duration) : 0;
      s.length = Math.max(own, s.lastFrame - s.tcStart, 1);
    });
    return { items, sources: [...sources.values()], start, end: at };
  }


  /* =========================================================
     FCPXML (Final Cut Pro, DaVinci Resolve)
     ========================================================= */

  function toFCPXML(edit, settings) {
    const { fps, width, height } = settings;
    const [num, den] = frameDuration(fps);
    const t = (frames) => frames === 0 ? "0s" : `${frames * num}/${den}s`;
    const { items, sources, start, end } = assemble(edit, settings);
    const rateCode = { 23.976: "2398", 29.97: "2997", 59.94: "5994" }[fps] || String(fps);   // e.g. FFVideoFormat1080p2398

    const assetIds = new Map();
    const assets = sources.map((s, i) => {
      const id = `r${i + 2}`;
      assetIds.set(s, id);
      return `    <asset id="${id}" name="${xml(s.name)}" start="${t(s.tcStart)}" duration="${t(s.length)}" hasVideo="1" hasAudio="1" format="r1" audioSources="1" audioChannels="2" audioRate="48000">
      <media-rep kind="original-media" src="${xml(fileUrl(s.clip, s.name, settings.pathMap))}"/>
    </asset>`;
    });

    const markerXml = (markers, localStart) => markers.map(m =>
      `          <marker start="${t(localStart)}" duration="${t(1)}" value="${xml(m.name)}"${m.comment ? ` note="${xml(m.comment)}"` : ""}/>`).join("\n");

    const spine = items.map(item => {
      if (item.type === "clip") {
        return `        <asset-clip ref="${assetIds.get(item.source)}" name="${xml(item.label)}" offset="${t(item.rec)}" start="${t(item.srcIn)}" duration="${t(item.length)}" format="r1" tcFormat="NDF">
${markerXml(item.markers, item.srcIn)}
        </asset-clip>`;
      }
      return `        <gap name="${xml(item.kind)}" offset="${t(item.rec)}" start="0s" duration="${t(item.length)}">
${markerXml(item.markers, 0)}
        </gap>`;
    }).join("\n").replace(/\n\n/g, "\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat${height}p${rateCode}" frameDuration="${num}/${den}s" width="${width}" height="${height}"/>
${assets.join("\n")}
  </resources>
  <library>
    <event name="${xml(Projects.activeName())}">
      <project name="${xml(edit.name)}">
        <sequence format="r1" duration="${t(end - start)}" tcStart="${t(start)}" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
  }


  /* =========================================================
     XML (Premiere Pro)
     ========================================================= */

  function toXMEML(edit, settings) {
    const { fps, width, height } = settings;
    const { items, sources, start, end } = assemble(edit, settings);
    const rate = `<rate><timebase>${Math.round(fps)}</timebase><ntsc>${ntsc(fps) ? "TRUE" : "FALSE"}</ntsc></rate>`;
    const fileIds = new Map(sources.map((s, i) => [s, `file-${i + 1}`]));
    const written = new Set();

    // The first mention of a file describes it in full; later ones only give its id
    const fileXml = (source) => {
      const id = fileIds.get(source);
      if (written.has(id)) return `<file id="${id}"/>`;
      written.add(id);
      return `<file id="${id}">
              <name>${xml(source.name)}</name>
              <pathurl>${xml(fileUrl(source.clip, source.name, settings.pathMap).replace(/^file:\/\/\//, "file://localhost/"))}</pathurl>
              ${rate}
              <duration>${source.length}</duration>
              <timecode>${rate}<string>${M.toTimecode(source.tcStart / fps, fps)}</string><frame>${source.tcStart}</frame><displayformat>NDF</displayformat></timecode>
              <media>
                <video><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height></samplecharacteristics></video>
                <audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>
              </media>
            </file>`;
    };

    const clips = items.filter(i => i.type === "clip");
    const clipItem = (item, n, track) => `
          <clipitem id="clipitem-${track}-${n + 1}">
            <name>${xml(item.label)}</name>
            <enabled>TRUE</enabled>
            <duration>${item.source.length}</duration>
            ${rate}
            <start>${item.rec - start}</start>
            <end>${item.rec - start + item.length}</end>
            <in>${item.srcIn - item.source.tcStart}</in>
            <out>${item.srcIn - item.source.tcStart + item.length}</out>
            ${fileXml(item.source)}${track === "a" ? `
            <sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` : ""}
          </clipitem>`;

    const markers = items.flatMap(item => item.markers.map(m => `
    <marker>
      <name>${xml(m.name)}</name>
      <comment>${xml(m.comment)}</comment>
      <in>${item.rec - start}</in>
      <out>${m.length ? item.rec - start + m.length : -1}</out>
    </marker>`)).join("");

    const video = clips.map((item, n) => clipItem(item, n, "v")).join("");
    const audio = clips.map((item, n) => clipItem(item, n, "a")).join("");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${xml(edit.name)}</name>
    <duration>${end - start}</duration>
    ${rate}
    <timecode>${rate}<string>${M.toTimecode(start / fps, fps)}</string><frame>${start}</frame><displayformat>NDF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics>${rate}<width>${width}</width><height>${height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>
        <track>${video}
        </track>
      </video>
      <audio>
        <track>${audio}
        </track>
      </audio>
    </media>${markers}
  </sequence>
</xmeml>
`;
  }


  /* =========================================================
     EDL (CMX3600)
     ========================================================= */

  function toEDL(edit, settings) {
    const { fps } = settings;
    const { items } = assemble(edit, settings);
    const tc = (frames) => M.toTimecode(frames / fps, fps);
    const lines = [`TITLE: ${oneLine(edit.name, 60).toUpperCase()}`, "FCM: NON-DROP FRAME", ""];

    items.forEach((item, n) => {
      const event = String(n + 1).padStart(3, "0");
      const rec = `${tc(item.rec)} ${tc(item.rec + item.length)}`;
      if (item.type === "clip") {
        lines.push(`${event}  AX       AA/V  C        ${tc(item.srcIn)} ${tc(item.srcIn + item.length)} ${rec}`);
        lines.push(`* FROM CLIP NAME: ${oneLine(item.source.name, 70)}`);
      } else {
        lines.push(`${event}  BL       V     C        ${tc(0)} ${tc(item.length)} ${rec}`);
      }
      item.markers.forEach(m => {
        lines.push(`* LOC: ${tc(item.rec)} ${item.type === "gap" ? "YELLOW " : "RED    "} ${oneLine(m.name, 70)}`);
        if (m.comment && m.comment !== m.name) lines.push(`* COMMENT: ${oneLine(m.comment, 70)}`);
      });
      lines.push("");
    });
    return lines.join("\r\n");
  }


  /* =========================================================
     RESOLVE MARKERS (EDL with Resolve's colours)
     Import in Resolve: right-click the timeline in the Media Pool ›
     Timelines › Import › Timeline Markers from EDL…
     ========================================================= */

  function toResolveMarkers(edit, settings, kinds) {
    const { fps } = settings;
    const { items } = assemble(edit, settings);
    const tc = (frames) => M.toTimecode(frames / fps, fps);
    const clean = (text) => oneLine(text, 80).replace(/\|/g, "/");
    const markers = [];
    items.forEach(item => {
      if (kinds.has("section")) item.markers.filter(m => m.name.startsWith("Section: "))
        .forEach(m => markers.push({ rec: item.rec, length: 1, color: MARKER_KINDS.section.color, name: m.name }));
      const kind = item.block?.kind;
      if (!kind || !kinds.has(kind)) return;
      const name = item.type === "clip" ? item.label : `${M.KINDS[kind].name}: ${oneLine(item.block.text, 70) || M.KINDS[kind].name}`;
      // Resolve keeps one marker per frame: after a section marker, start a frame later
      const taken = markers.some(m => m.rec === item.rec);
      markers.push({ rec: item.rec + (taken ? 1 : 0), length: item.length - (taken ? 1 : 0), color: MARKER_KINDS[kind].color, name });
    });
    const lines = [`TITLE: ${oneLine(edit.name, 60)}`, "FCM: NON-DROP FRAME", ""];
    markers.forEach((m, n) => {
      lines.push(`${String(n + 1).padStart(3, "0")}  001      V     C        ${tc(m.rec)} ${tc(m.rec + 1)} ${tc(m.rec)} ${tc(m.rec + 1)}  `);
      lines.push(` |C:ResolveColor${m.color} |M:${clean(m.name)} |D:${Math.max(1, m.length)}`);
      lines.push("");
    });
    return { text: lines.join("\r\n"), count: markers.length };
  }


  /* =========================================================
     THE EXPORT TAB
     ========================================================= */

  const settings = { editId: null, fps: null, start: "01:00:00:00", size: "1920x1080", pathFor: "",
                     markerKinds: new Set(Object.keys(MARKER_KINDS)) };

  function render(panel) {
    const media = Page.media;
    const edits = Page.edits;
    settings.fps ??= media.fps;

    if (!edits.length || !edits.some(e => e.blocks.length)) {
      panel.replaceChildren(el("p", { class: "media-empty" }, "Nothing to export yet. Build an edit on the ",
        el("button", { type: "button", class: "comment-action", onclick: () => Page.show("edit") }, "Text Edit"), " tab first."));
      return;
    }
    if (!edits.some(e => e.id === settings.editId)) {
      settings.editId = edits.find(e => e.id === localStorage.getItem(`textEditCurrent:${Projects.activeId()}`))?.id || edits[0].id;
    }

    const editSelect = el("select", { class: "team-select", "aria-label": "Edit to export" }, edits.map(e => el("option", { value: e.id }, e.name)));
    editSelect.value = settings.editId;
    const fpsSelect = el("select", { class: "team-select", "aria-label": "Sequence frame rate" }, M.FRAME_RATES.map(f => el("option", { value: String(f) }, `${f} fps`)));
    fpsSelect.value = String(settings.fps);
    const startInput = el("input", { class: "tc-input export-start", "aria-label": "Sequence start timecode", value: settings.start });
    const sizeSelect = el("select", { class: "team-select", "aria-label": "Frame size" }, Object.entries(SIZES).map(([v, n]) => el("option", { value: v }, n)));
    sizeSelect.value = settings.size;

    // Clip paths: as imported, or pointed at someone else's copy of the footage
    const root = Page.clipRoot();
    const people = media.locations.filter(l => l.footage);
    if (!people.some(l => l.id === settings.pathFor)) settings.pathFor = "";
    const pathSelect = el("select", { class: "team-select", "aria-label": "Clip paths for" },
      el("option", { value: "" }, "As imported"),
      people.map(l => el("option", { value: l.id }, l.person || l.footage)));
    pathSelect.value = settings.pathFor;
    pathSelect.disabled = !root || !people.length;
    pathSelect.title = !root ? "Import clips from a timeline first" : !people.length ? "Add people's footage folders on the Media tab" : "";
    pathSelect.addEventListener("change", () => { settings.pathFor = pathSelect.value; update(); });

    const summary = el("div", { class: "export-summary" });
    const update = () => {
      settings.editId = editSelect.value;
      settings.fps = Number(fpsSelect.value);
      settings.size = sizeSelect.value;
      const start = M.fromTimecode(startInput.value, settings.fps);
      startInput.setAttribute("aria-invalid", String(start == null));
      if (start != null) settings.start = M.toTimecode(start, settings.fps);
      renderSummary(summary);
    };
    [editSelect, fpsSelect, sizeSelect].forEach(s => s.addEventListener("change", update));
    startInput.addEventListener("change", () => { update(); startInput.value = settings.start; });

    const go = (kind) => {
      const edit = Page.edits.find(e => e.id === settings.editId);
      const [width, height] = settings.size.split("x").map(Number);
      const loc = media.locations.find(l => l.id === settings.pathFor);
      const options = { fps: settings.fps, start: M.fromTimecode(settings.start, settings.fps) || 0, width, height,
                        pathMap: loc ? { from: Page.clipRoot(), to: loc.footage } : null };
      const name = slug(edit.name) + (loc?.person ? `-${slug(loc.person)}` : "");
      if (kind === "fcpxml") download(toFCPXML(edit, options), `${name}.fcpxml`, "application/xml");
      if (kind === "xml") download(toXMEML(edit, options), `${name}.xml`, "application/xml");
      if (kind === "edl") download(toEDL(edit, options), `${name}.edl`, "text/plain");
      if (kind === "markers") {
        const { text, count } = toResolveMarkers(edit, options, settings.markerKinds);
        if (!count) { Page.setStatus("No markers to export: tick at least one kind."); return; }
        download(text, `${slug(edit.name)}-resolve-markers.edl`, "text/plain");
      }
    };

    const markerKinds = el("div", { class: "marker-kinds", role: "group", "aria-label": "Markers to include" },
      Object.entries(MARKER_KINDS).map(([kind, k]) => {
        const box = el("input", { type: "checkbox", checked: settings.markerKinds.has(kind) });
        box.addEventListener("change", () => { box.checked ? settings.markerKinds.add(kind) : settings.markerKinds.delete(kind); });
        const dot = el("span", { class: "speaker-dot", "aria-hidden": "true" });
        dot.style.background = M.MARKER_COLORS[k.color];
        return el("label", { class: "marker-kind" }, box, dot, `${k.name} (${k.color})`);
      }));

    panel.replaceChildren(
      el("section", { class: "callout-box accent-4 export-box" },
        el("h2", {}, "Export a timeline"),
        el("p", {}, "Creates a file your editing software can open. Soundbites become clips at their source timecode. Narration, B-roll and titles become gaps with a marker holding their text, and sections become markers."),
        el("div", { class: "export-settings" },
          el("label", {}, "Edit", editSelect),
          el("label", {}, "Frame rate", fpsSelect),
          el("label", {}, "Starts at", startInput),
          el("label", {}, "Frame size", sizeSelect),
          el("label", {}, "Clip paths for", pathSelect)),
        summary,
        el("div", { class: "export-buttons" },
          el("button", { type: "button", class: "small-btn", onclick: () => go("fcpxml") }, "Final Cut Pro / Resolve (.fcpxml)"),
          el("button", { type: "button", class: "small-btn", onclick: () => go("xml") }, "Premiere Pro (.xml)"),
          el("button", { type: "button", class: "small-btn", onclick: () => go("edl") }, "EDL (.edl)"))),
      el("section", { class: "callout-box accent-3 export-box" },
        el("h2", {}, "Coloured markers for Resolve"),
        el("p", {}, "A marker for every line of the edit, coloured by kind, spanning its length. Import the timeline first, then in Resolve right-click that timeline in the Media Pool › Timelines › Import › Timeline Markers from EDL… and choose this file. Use the same frame rate and start timecode as the timeline."),
        markerKinds,
        el("div", { class: "export-buttons" },
          el("button", { type: "button", class: "small-btn", onclick: () => go("markers") }, "Resolve markers (.edl)"))),
      el("section", { class: "media-section export-help" },
        el("h2", {}, "Opening it in your editor"),
        el("ul", {},
          el("li", {}, el("strong", {}, "Final Cut Pro: "), "File › Import › XML…, then relink any missing clips with File › Relink Files."),
          el("li", {}, el("strong", {}, "DaVinci Resolve: "), "File › Import › Timeline… (choose the .fcpxml or .xml). Untick “Automatically import source clips into media pool” if your clips are already there."),
          el("li", {}, el("strong", {}, "Premiere Pro: "), "File › Import… and pick the .xml. Use Link Media if it asks where the clips are."),
          el("li", {}, el("strong", {}, "EDL: "), "most editors import it from File › Import. EDLs have no clip paths, so clips are matched by name.")),
        el("p", { class: "media-muted" }, "This is a round trip through files, not a live connection: edits you make in the editor don't come back here. Markers do: export them from Resolve and use Import Resolve markers on the Media & Transcripts tab.")));
    update();
  }

  /* What's in the export, and anything to watch out for */
  function renderSummary(box) {
    const media = Page.media;
    const edit = Page.edits.find(e => e.id === settings.editId);
    const soundbites = edit.blocks.filter(b => b.kind === "soundbite");
    const gaps = edit.blocks.filter(b => ["narration", "broll", "title"].includes(b.kind));
    const total = M.runningTimes(media, edit.blocks).total;

    const warnings = [];
    const unlinked = new Set(), noPath = new Set(), otherRate = new Set(), estimated = new Set();
    soundbites.forEach(b => {
      const src = M.sourceOf(media, b);
      if (!src.clip) unlinked.add(src.clipName);
      else {
        if (!src.clip.path) noPath.add(src.clip.name);
        if (src.clip.fps && src.clip.fps !== settings.fps) otherRate.add(`${src.clip.name} (${src.clip.fps} fps)`);
      }
      if (src.transcript?.estimated) estimated.add(src.transcript.title);
    });
    if (unlinked.size) warnings.push(`Not in your clip list, so timecodes start at 00:00:00:00 and the editor will ask you to find them: ${[...unlinked].join(", ")}. Import the timeline the clips came from on the Media tab to fix this.`);
    if (noPath.size) warnings.push(`No file location known (added by hand), so the editor will ask you to relink: ${[...noPath].join(", ")}.`);
    if (otherRate.size) warnings.push(`Different frame rate from the sequence: ${[...otherRate].join(", ")}.`);
    if (estimated.size) warnings.push(`Transcripts without timecodes (times are estimates, so check the cuts): ${[...estimated].join(", ")}.`);

    box.replaceChildren(
      el("p", {}, `${plural(soundbites.length, "clip")}, ${plural(gaps.length, "gap")} with markers · runs ${M.formatDuration(total)}`),
      warnings.length ? el("ul", { class: "export-warnings" }, warnings.map(w => el("li", {}, w))) : "");
  }


  /* ---------- Hook into the page (and let tests reach the writers) ---------- */
  Page.register("export", { render });
  window.TimelineExport = { toFCPXML, toXMEML, toEDL, toResolveMarkers, assemble };
})();
