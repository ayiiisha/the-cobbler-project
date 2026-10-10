/* =========================================================
   media.js — the Media & Transcripts page (and its Media tab)
   ---------------------------------------------------------
   The page has three tabs:
     Media & Transcripts  this file: import transcripts and clips,
                          link them, rename speakers, search
     Text Edit            text-edit.js: the paper edit
     Export Timeline      timeline-export.js: files for editors

   The Media tab also keeps DaVinci Resolve markers and notes on
   where each person keeps the footage, inside project.data.media:
     markerSets: [{ id, file, imported, fps, start, markers: [{ id, at, duration, color, name, note, commented }] }]
                 (at = timeline timecode in seconds; start = the timeline's start, usually 01:00:00:00)
     locations:  [{ id, person, footage, proxies, notes }]

   This file also holds what the tabs share, as window.MediaPage:
     MediaPage.media / .edits       the project's data (see media-core.js)
     MediaPage.saveMedia()          store transcripts and clips
     MediaPage.saveEdits()          store paper edits
     MediaPage.show(tab, options)   switch tab, e.g. show("edit", { transcriptId, segment })
     MediaPage.register(tab, { render })   a tab draws itself when shown

   Needs projects-core.js and media-core.js.
   ========================================================= */
(() => {

  if (!window.Projects || !window.MediaCore) {
    console.error("media.js: load projects-core.js and media-core.js first.");
    return;
  }

  const M = window.MediaCore;
  const $ = (id) => document.getElementById(id);


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

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

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // Each speaker gets a colour (the same one everywhere on the page)
  const SPEAKER_COLORS = ["#FAD39D", "#BCF4FA", "#E7B7FA", "#FAA8C1", "#C8F2B8", "#FFE08A", "#C9D4FF", "#F7C6A3"];
  function speakerColor(transcript, raw) {
    const keys = [...new Set(transcript.segments.map(s => s.speaker))];
    return SPEAKER_COLORS[Math.max(0, keys.indexOf(raw)) % SPEAKER_COLORS.length];
  }

  let statusTimer = 0;
  function setStatus(message) {
    $("media-status").textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { $("media-status").textContent = ""; }, 9000);
  }


  /* =========================================================
     SHARED PAGE STATE
     ========================================================= */

  const tabs = {};
  const media = M.loadMedia();
  media.markerSets = Array.isArray(media.markerSets) ? media.markerSets : [];
  media.locations = Array.isArray(media.locations) ? media.locations : [];
  const Page = {
    media,
    edits: M.loadEdits(),
    el, plural, speakerColor, setStatus,

    // "file:///Volumes/SSD/a%20b.mov" → "/Volumes/SSD/a b.mov"; "D:\\x.mov" → "D:/x.mov"
    localPath(path) {
      let p = String(path || "").trim();
      if (!p) return "";
      if (/^file:\/\//i.test(p)) {
        p = p.replace(/^file:\/\/(localhost)?/i, "");
        try { p = decodeURIComponent(p); } catch {}
        if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);   // /D:/… → D:/…
      }
      return p.replace(/\\/g, "/");
    },

    saveMedia() { Projects.setData("media", M.packMedia(Page.media)); },   // transcripts kept elsewhere are saved without their words
    saveEdits() { Projects.setData("edits", Page.edits); },

    register(name, tab) { tabs[name] = tab; },

    /* Switches tab. Options are passed to the tab (e.g. which transcript to open). */
    show(name, options = {}) {
      document.querySelectorAll("#media-tabs [role=tab]").forEach(button => {
        const selected = button.dataset.tab === name;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
      });
      ["media", "edit", "export"].forEach(t => { $(`panel-${t}`).hidden = t !== name; });
      history.replaceState(null, "", name === "media" ? location.pathname : `#${name}`);
      (name === "media" ? renderMedia : tabs[name]?.render)?.($(`panel-${name}`), options);
    },
  };
  window.MediaPage = Page;


  /* =========================================================
     IMPORTING TRANSCRIPTS
     ========================================================= */

  /* Adds a transcript from text. Returns it, or null if nothing could be read. */
  function addTranscript(text, { title, file = "" }) {
    const parsed = M.parseTranscript(text, file);
    if (!parsed.segments.length) return null;
    if (parsed.shifted) shiftedOnImport.push(title);
    const transcript = {
      id: M.newId("t"),
      title: title.replace(/\.(srt|vtt|txt)$/i, ""),
      file,
      clipName: "",
      speakers: {},
      segments: parsed.segments,
      estimated: parsed.estimated,
      format: parsed.format,
      added: Date.now(),
    };
    Page.media.transcripts.push(transcript);
    return transcript;
  }

  // Transcripts whose times began an hour or more in (e.g. Resolve's 01:00:00:00 timeline start)
  const shiftedOnImport = [];

  async function importTranscriptFiles(files) {
    const added = [], failed = [];
    shiftedOnImport.length = 0;
    for (const file of files) {
      try {
        const transcript = addTranscript(await file.text(), { title: file.name, file: file.name });
        (transcript ? added : failed).push(file.name);
      } catch {
        failed.push(file.name);
      }
    }
    Page.saveMedia();
    renderMedia();
    setStatus([
      added.length && `Added ${plural(added.length, "transcript")}.`,
      failed.length && `Couldn't find any text with timecodes in: ${failed.join(", ")}.`,
      shiftedOnImport.length && `Times in ${shiftedOnImport.join(", ")} started an hour or more in (a timeline's start, as Resolve exports them), so they now start from 00:00. Use “Shift times” on a transcript to change this.`,
    ].filter(Boolean).join(" "));
  }


  /* =========================================================
     IMPORTING CLIPS FROM A TIMELINE
     ========================================================= */

  async function importTimeline(file) {
    let result;
    try {
      result = M.parseTimeline(await file.text());
    } catch (err) {
      setStatus(`Couldn't read ${file.name}: ${err.message}.`);
      return;
    }

    // New clips are added; clips with the same name are updated
    let added = 0, updated = 0;
    result.clips.filter(c => c.name).forEach(c => {
      const existing = Page.media.clips.find(x => x.name === c.name);
      const fields = { duration: c.duration, tcStart: c.tcStart, fps: c.fps, path: c.path, source: result.format };
      if (existing) { Object.assign(existing, fields); updated++; }
      else { Page.media.clips.push({ id: M.newId("c"), name: c.name, ...fields }); added++; }
    });
    // The first timeline sets the project's frame rate
    if (!Page.media.clipsImported) {
      Page.media.fps = result.fps;
      Page.media.clipsImported = true;
    }
    Page.saveMedia();
    renderMedia();
    const linked = Page.media.transcripts.filter(t => M.clipFor(Page.media, t)).length;
    setStatus(`${result.format}: ${plural(added, "new clip")}${updated ? `, ${updated} updated` : ""}. ` +
              `${linked} of ${plural(Page.media.transcripts.length, "transcript")} linked to a clip.`);
  }


  /* =========================================================
     MEDIA TAB
     ========================================================= */

  function renderMedia() {
    const fpsSelect = $("media-fps");
    fpsSelect.replaceChildren(...M.FRAME_RATES.map(f => el("option", { value: String(f) }, `${f} fps`)));
    fpsSelect.value = String(Page.media.fps);
    renderTranscripts();
    renderMarkers();
    renderClips();
    renderLocations();
    renderSearch();
  }

  /* ---------- Transcripts: link to a clip, rename speakers ---------- */
  function renderTranscripts() {
    const list = $("transcript-list");
    const { media } = Page;
    if (!media.transcripts.length) {
      list.replaceChildren(el("p", { class: "media-empty" }, "No transcripts yet. Import .srt, .vtt or .txt files, or paste one in."));
      return;
    }

    list.replaceChildren(...media.transcripts.map(t => {
      const clip = M.clipFor(media, t);
      const duration = t.segments.length ? t.segments[t.segments.length - 1].end - t.segments[0].start : 0;
      const speakers = [...new Set(t.segments.map(s => s.speaker))];

      const title = el("input", { class: "transcript-title", "aria-label": "Transcript name", value: t.title, maxlength: "120" });
      title.addEventListener("change", () => { t.title = title.value.trim() || t.title; Page.saveMedia(); renderMedia(); });

      // Clip link: automatic (by name) or picked
      const link = el("select", { class: "team-select", "aria-label": `Clip for ${t.title}` },
        el("option", { value: "" }, clip && !t.clipName ? `Matched by name: ${clip.name}` : "Match by name (none found)"),
        media.clips.map(c => el("option", { value: c.name }, c.name)));
      link.value = t.clipName;
      link.addEventListener("change", () => { t.clipName = link.value; Page.saveMedia(); renderMedia(); });

      return el("article", { class: "transcript-card" },
        el("header", { class: "transcript-card-head" }, title,
          el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "small-btn", onclick: () => Page.show("edit", { transcriptId: t.id }) }, "Open in Text Edit"),
            el("button", { type: "button", class: "comment-action", onclick: () => shiftTranscript(t) }, "Shift times"),
            el("button", { type: "button", class: "comment-action", onclick: () => {
              const used = Page.edits.reduce((n, e) => n + e.blocks.filter(b => b.transcriptId === t.id).length, 0);
              if (!confirm(`Delete the transcript “${t.title}”?` + (used ? ` ${plural(used, "soundbite")} in your edits will keep their text and timecodes.` : ""))) return;
              media.transcripts = media.transcripts.filter(x => x !== t);
              M.forgetStoredWords(t);
              Page.saveMedia();
              renderMedia();
            } }, "Delete"))),
        el("p", { class: "transcript-meta" },
          `${t.format?.toUpperCase() || "Text"} · ${plural(t.segments.length, "paragraph")} · ${M.formatDuration(duration)}`,
          clip ? ` · starts ${M.toTimecode(clip.tcStart, clip.fps)}` : "",
          t.estimated && el("span", { class: "transcript-warning" }, " · no timecodes in the file, times are estimated")),
        storageRow(t),
        el("label", { class: "transcript-field" }, "Clip", link),
        el("div", { class: "transcript-speakers" },
          el("span", { class: "transcript-field-label" }, "Speakers"),
          speakers.map(raw => {
            const input = el("input", { value: M.speakerName(t, raw), "aria-label": `Name for ${raw || "unlabelled speaker"}`, maxlength: "60" });
            input.addEventListener("change", () => {
              const name = input.value.trim();
              if (name && name !== raw) t.speakers[raw] = name; else delete t.speakers[raw];
              Page.saveMedia();
              renderSearch();
            });
            const dot = el("span", { class: "speaker-dot", "aria-hidden": "true" });
            dot.style.background = speakerColor(t, raw);
            return el("label", { class: "speaker-field", title: raw ? `Labelled “${raw}” in the file` : "No label in the file" }, dot, input);
          })));
    }));
  }

  /* =========================================================
     WHERE TRANSCRIPTS ARE KEPT
     Inside the project, in this browser's file storage, or as files
     in a folder (e.g. a shared Google Drive folder). Every move is
     logged on the transcript. See media-core.js.
     ========================================================= */

  const SYNC_HANDLE = "sync-folder-handle";
  const folders = { own: null, sync: null };   // remembered folder handles (names shown in the menus)

  async function loadFolders() {
    if (!window.FileStore) return;
    try { folders.own = await FileStore.get(M.FOLDER_HANDLE) || null; } catch {}
    try { folders.sync = await FileStore.get(SYNC_HANDLE) || null; } catch {}
  }

  function placeOptions(current) {
    return [
      el("option", { value: "" }, "Move to…"),
      current !== "project" && el("option", { value: "project" }, "Inside the project"),
      current !== "browser" && el("option", { value: "browser" }, "This browser's file storage"),
      folders.own && el("option", { value: "own" }, `Folder “${folders.own.name}”`),
      folders.sync && folders.sync.name !== folders.own?.name && el("option", { value: "sync" }, `Sync folder “${folders.sync.name}”`),
      window.showDirectoryPicker && el("option", { value: "choose" }, "Choose a folder… (e.g. Google Drive)"),
    ];
  }

  /* The folder handle for a menu choice, asking for permission (needs the click/change) */
  async function rootFor(choice) {
    if (choice === "choose") {
      const handle = await window.showDirectoryPicker({ id: "cobbler-transcripts", mode: "readwrite" });
      await FileStore.put(M.FOLDER_HANDLE, handle);
      folders.own = handle;
      return handle;
    }
    const handle = choice === "sync" ? folders.sync : folders.own;
    if (!handle) throw new Error("that folder isn't set up any more");
    if (await handle.requestPermission({ mode: "readwrite" }) !== "granted") throw new Error(`no permission to write to “${handle.name}”`);
    return handle;
  }

  /* Moves some transcripts. choice: "project", "browser", "own", "sync" or "choose". */
  async function moveTranscripts(list, choice) {
    if (Projects.isReadOnly()) { setStatus("This project is read-only, so its transcripts can't be moved."); return; }
    try {
      const root = ["own", "sync", "choose"].includes(choice) ? await rootFor(choice) : null;
      const where = root ? "folder" : choice;
      // Already there: nothing to do (a folder can be moved to again, e.g. a different one)
      list = list.filter(t => where === "folder" || (t.storage?.where || "project") !== where);
      if (!list.length) { setStatus("They're all there already."); return; }
      for (const t of list) await M.moveTranscript(t, where, { root });
      Page.saveMedia();
      renderMedia();
      const place = M.describeStorage(list[list.length - 1]?.storage);
      setStatus(list.length === 1 ? `“${list[0].title}” is now kept in: ${place}.` : `${plural(list.length, "transcript")} moved. Now kept in: ${place}.`);
    } catch (error) {
      if (error?.name === "AbortError") return;   // closed the folder picker
      setStatus(`Couldn't move: ${error.message || error}.`);
      renderMedia();
    }
  }

  function storageRow(t) {
    const external = M.isExternal(t);
    const select = el("select", { class: "team-select", "aria-label": `Move “${t.title}”` }, placeOptions(external ? t.storage.where === "folder" ? "" : t.storage.where : "project"));
    select.addEventListener("change", () => { if (select.value) moveTranscripts([t], select.value); });
    const log = Array.isArray(t.storageLog) ? t.storageLog : [];
    return el("div", { class: "transcript-storage" },
      el("p", { class: "transcript-meta" },
        el("strong", {}, "Stored in: "), M.describeStorage(t.storage),
        external && !M.isLoaded(t) && el("span", { class: "transcript-warning" }, " · not found here: open the folder or ask whoever moved it to share the project again"),
        external && t.storage.at ? ` (moved ${new Date(t.storage.at).toLocaleString()} by ${t.storage.by || "someone"})` : ""),
      el("label", { class: "transcript-field" }, "Keep it", select),
      log.length > 0 && el("details", { class: "transcript-storage-log" },
        el("summary", {}, `Where it's been (${plural(log.length, "move")})`),
        el("ol", {}, log.slice().reverse().map(e => el("li", {},
          `${new Date(e.at).toLocaleString()} · ${e.by || "Someone"} · ${M.describeStorage(e)}`)))));
  }

  /* Moves every time in a transcript, e.g. "-01:00:00:00" when a file came from a timeline */
  function shiftTranscript(t) {
    const answer = prompt(`Move every time in “${t.title}” by how much? Use - to move earlier.\nFor example -01:00:00:00, +00:00:02:00 or -2.5s`, "-01:00:00:00");
    if (answer == null || !answer.trim()) return;
    const sign = answer.trim().startsWith("-") ? -1 : 1;
    const amount = M.fromTimecode(answer.trim().replace(/^[+-]/, ""), Page.media.fps);
    if (amount == null) { setStatus(`Couldn't read “${answer}” as a time.`); return; }
    M.shiftSegments(t.segments, sign * amount);
    M.saveStoredWords(t).then(() => Page.saveMedia(), (error) => setStatus(`Couldn't save the moved times: ${error.message || error}.`));
    Page.saveMedia();
    renderMedia();
    setStatus(`Moved “${t.title}” ${sign < 0 ? "earlier" : "later"} by ${M.toTimecode(amount, Page.media.fps)}. Soundbites already in edits keep their old times.`);
  }


  /* =========================================================
     DAVINCI RESOLVE MARKERS
     ========================================================= */

  const teamNames = () => {
    const team = Projects.getData("team", []);
    return Array.isArray(team) ? team.map(m => m.name).filter(Boolean) : [];
  };

  async function importMarkerFiles(files) {
    const done = [], failed = [];
    for (const file of files) {
      try {
        const result = M.parseMarkers(await file.text(), file.name, Page.media.fps);
        if (!result.markers.length) throw new Error("no markers in it");
        // The timeline's start: 01:00:00:00 if every marker is an hour or more in (Resolve's default)
        const first = Math.min(...result.markers.map(m => m.at));
        Page.media.markerSets.push({
          id: M.newId("ms"), file: file.name, imported: Date.now(), fps: result.fps,
          start: Math.floor(first / 3600) * 3600,
          markers: result.markers.sort((a, b) => a.at - b.at).map(m => ({ id: M.newId("mk"), ...m, commented: false })),
        });
        done.push(`${file.name} (${plural(result.markers.length, "marker")})`);
      } catch (err) {
        failed.push(`${file.name}: ${err.message}`);
      }
    }
    Page.saveMedia();
    renderMarkers();
    setStatus([done.length && `Imported markers from ${done.join(", ")}.`, failed.length && `Couldn't read ${failed.join("; ")}.`].filter(Boolean).join(" "));
    if (done.length) $("markers-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* Adds markers as comments on this page (open the Comments button to see them) */
  function markersToComments(set, markers) {
    if (!window.CobblerComments?.addPageComments) return;
    const fresh = markers.filter(m => !m.commented);
    if (!fresh.length) { setStatus("Those markers are already in the comments."); return; }
    CobblerComments.addPageComments("media-and-transcripts", fresh.map(m => CobblerComments.createThread(
      [m.name, m.note].filter(Boolean).join(" — ") || `${m.color} marker`,
      { quote: `${set.file} · ${M.toTimecode(m.at, set.fps)} · ${m.color} marker`, anchor: { time: m.at - set.start }, author: "DaVinci Resolve" })));
    fresh.forEach(m => { m.commented = true; });
    Page.saveMedia();
    renderMarkers();
    setStatus(`Added ${plural(fresh.length, "marker")} as comments. Open Comments (bottom right) to reply, assign or resolve them.`);
  }

  function renderMarkers() {
    const box = $("marker-sets");
    const sets = Page.media.markerSets;
    if (!sets.length) {
      box.replaceChildren(el("p", { class: "media-empty" },
        "Notes made in Resolve, brought in here. In Resolve, right-click the timeline in the Media Pool › Timelines › Export › Timeline Markers to EDL…, then Import Resolve markers above. A CSV from the Edit Index (markers) works too."));
      return;
    }
    box.replaceChildren(...sets.map(set => {
      const start = el("input", { class: "tc-input", "aria-label": "Timeline starts at", value: M.toTimecode(set.start, set.fps) });
      start.addEventListener("change", () => {
        const seconds = M.fromTimecode(start.value, set.fps);
        start.setAttribute("aria-invalid", String(seconds == null));
        if (seconds == null) return;
        set.start = seconds;
        Page.saveMedia();
        renderMarkers();
      });
      const colors = [...new Set(set.markers.map(m => m.color))];
      const rows = set.markers.map(m => el("tr", { class: m.commented ? "is-commented" : null },
        el("td", { class: "tc-cell" }, M.toTimecode(m.at, set.fps)),
        el("td", { class: "tc-cell" }, M.formatDuration(Math.max(0, m.at - set.start))),
        el("td", {}, el("span", { class: "marker-color" }, colorDot(m.color), m.color)),
        el("td", {}, m.name || el("span", { class: "media-muted" }, "No name")),
        el("td", { class: "marker-note" }, m.note),
        el("td", {}, m.commented ? el("span", { class: "media-muted" }, "In comments") : "")));
      return el("article", { class: "transcript-card marker-set" },
        el("header", { class: "transcript-card-head" },
          el("h3", {}, set.file),
          el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "small-btn", onclick: () => markersToComments(set, set.markers) }, "Add all as comments"),
            colors.length > 1 && colors.map(c => el("button", { type: "button", class: "comment-action", onclick: () => markersToComments(set, set.markers.filter(m => m.color === c)) }, `Only ${c}`)),
            el("button", { type: "button", class: "comment-action", onclick: () => {
              if (!confirm(`Remove the markers from ${set.file}? Comments made from them stay.`)) return;
              Page.media.markerSets = sets.filter(x => x !== set);
              Page.saveMedia();
              renderMarkers();
            } }, "Remove"))),
        el("p", { class: "transcript-meta" }, `${plural(set.markers.length, "marker")} · imported ${new Date(set.imported).toLocaleDateString()} · `,
          el("label", { class: "marker-start" }, "Timeline starts at ", start)),
        el("div", { class: "tracker-wrap" }, el("table", { class: "tracker-table marker-table" },
          el("thead", {}, el("tr", {}, ["Timecode", "From start", "Colour", "Name", "Note", ""].map(h => el("th", { scope: "col" }, h)))),
          el("tbody", {}, rows))),
        el("p", { class: "media-muted" }, "“From start” is the time into the video, used for YouTube chapters on the Packaging page."));
    }));
  }

  function colorDot(color) {
    const dot = el("span", { class: "speaker-dot", "aria-hidden": "true" });
    dot.style.background = M.MARKER_COLORS[color] || "#999";
    return dot;
  }


  /* =========================================================
     WHERE EVERYONE KEEPS THE MEDIA
     ========================================================= */

  // The folder the imported clips share, e.g. "/Volumes/Aisha SSD/Rent Doc/Footage/"
  function clipRoot() {
    const paths = Page.media.clips.map(c => Page.localPath(c.path)).filter(Boolean);
    if (!paths.length) return "";
    let root = paths[0].slice(0, paths[0].lastIndexOf("/") + 1);
    paths.forEach(p => { while (root && !p.startsWith(root)) root = root.slice(0, root.slice(0, -1).lastIndexOf("/") + 1); });
    return root;
  }

  Page.clipRoot = clipRoot;

  function renderLocations() {
    const table = $("location-table");
    const list = Page.media.locations;
    const root = clipRoot();
    $("location-root").textContent = root
      ? `The clips you imported live in: ${root}`
      : "Import clips from a timeline to see where they live (clips added by hand have no location).";

    const names = teamNames();
    const datalist = el("datalist", { id: "location-people" }, names.map(n => el("option", { value: n })));
    if (!list.length) {
      table.replaceChildren(el("tbody", {}, el("tr", {}, el("td", { class: "media-empty-cell" },
        "No one yet. Add each person who edits this project and where their copy of the footage is."))), datalist);
      return;
    }
    const cell = (loc, key, label, placeholder) => {
      const input = el("input", { value: loc[key] || "", "aria-label": label, placeholder, list: key === "person" ? "location-people" : null });
      input.addEventListener("change", () => { loc[key] = input.value.trim(); Page.saveMedia(); });
      return el("td", {}, input);
    };
    table.replaceChildren(
      el("thead", {}, el("tr", {}, ["Person", "Footage folder", "Proxies folder", "Notes (drive, computer)", ""].map(h => el("th", { scope: "col" }, h)))),
      el("tbody", {}, list.map(loc => el("tr", {},
        cell(loc, "person", "Person", "Name"),
        cell(loc, "footage", "Footage folder", root || "/Volumes/Drive/Project/Footage/"),
        cell(loc, "proxies", "Proxies folder", "/Volumes/Drive/Project/Proxies/"),
        cell(loc, "notes", "Notes", "e.g. Samsung T7, Mac"),
        el("td", {}, el("button", { type: "button", class: "comment-action", "aria-label": `Remove ${loc.person || "this person"}`, onclick: () => {
          Page.media.locations = list.filter(x => x !== loc);
          Page.saveMedia();
          renderLocations();
        } }, "Remove"))))),
      datalist);
  }


  /* ---------- Clips: name, start timecode, frame rate ---------- */
  function renderClips() {
    const { media } = Page;
    const table = $("clip-table");
    if (!media.clips.length) {
      table.replaceChildren(el("tbody", {}, el("tr", {}, el("td", { class: "media-empty-cell" },
        "No clips yet. Import a timeline (FCPXML or Premiere XML) or add clips by hand. Without clips, transcripts start at 00:00:00:00."))));
      return;
    }

    const head = el("tr", {}, ["Clip name", "Starts at", "Length", "Frame rate", "Transcripts", ""].map(h => el("th", { scope: "col" }, h)));
    const rows = media.clips.map(c => {
      const name = el("input", { value: c.name, "aria-label": "Clip name", maxlength: "200" });
      name.addEventListener("change", () => {
        const old = c.name;
        c.name = name.value.trim() || old;
        media.transcripts.forEach(t => { if (t.clipName === old) t.clipName = c.name; });
        Page.saveMedia();
        renderMedia();
      });

      const start = el("input", { value: M.toTimecode(c.tcStart || 0, c.fps || media.fps), "aria-label": "Start timecode", class: "tc-input" });
      start.addEventListener("change", () => {
        const seconds = M.fromTimecode(start.value, c.fps || media.fps);
        if (seconds == null) { start.setAttribute("aria-invalid", "true"); return; }
        start.setAttribute("aria-invalid", "false");
        c.tcStart = seconds;
        start.value = M.toTimecode(seconds, c.fps || media.fps);
        Page.saveMedia();
        renderTranscripts();
      });

      const fps = el("select", { "aria-label": "Clip frame rate" }, M.FRAME_RATES.map(f => el("option", { value: String(f) }, String(f))));
      fps.value = String(c.fps || media.fps);
      fps.addEventListener("change", () => { c.fps = Number(fps.value); Page.saveMedia(); renderMedia(); });

      const linked = media.transcripts.filter(t => M.clipFor(media, t) === c).map(t => t.title);
      return el("tr", { title: c.path || "" },
        el("td", {}, name),
        el("td", {}, start),
        el("td", {}, c.duration ? M.formatDuration(c.duration) : "–"),
        el("td", {}, fps),
        el("td", { class: "clip-linked" }, linked.length ? linked.join(", ") : el("span", { class: "media-muted" }, "None")),
        el("td", {}, el("button", { type: "button", class: "comment-action", "aria-label": `Remove clip ${c.name}`, onclick: () => {
          media.clips = media.clips.filter(x => x !== c);
          Page.saveMedia();
          renderMedia();
        } }, "Remove")));
    });
    table.replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  }

  /* ---------- Search across every transcript ---------- */
  function renderSearch() {
    const box = $("media-results");
    const query = $("media-search").value.trim();
    if (!query) { box.replaceChildren(); return; }

    const needle = query.toLowerCase();
    const results = [];
    for (const t of Page.media.transcripts) {
      const clip = M.clipFor(Page.media, t);
      t.segments.forEach((s, i) => {
        const name = M.speakerName(t, s.speaker);
        const at = s.text.toLowerCase().indexOf(needle);
        if (at < 0 && !name.toLowerCase().includes(needle)) return;
        results.push({ t, s, i, at, clip, name });
      });
      if (results.length > 300) break;
    }

    if (!results.length) {
      box.replaceChildren(el("p", { class: "media-empty" }, `No matches for “${query}”.`));
      return;
    }

    box.replaceChildren(
      el("p", { class: "media-muted" }, `${results.length} match${results.length === 1 ? "" : "es"}${results.length > 300 ? " (showing the first 300)" : ""}`),
      el("ul", { class: "search-results" }, results.slice(0, 300).map(r => {
        // A snippet around the match, with the match highlighted
        const from = Math.max(0, r.at - 60);
        const to = r.at < 0 ? Math.min(r.s.text.length, 140) : Math.min(r.s.text.length, r.at + needle.length + 80);
        const snippet = r.at < 0
          ? [r.s.text.slice(0, to)]
          : [from ? "…" : "", r.s.text.slice(from, r.at), el("mark", {}, r.s.text.slice(r.at, r.at + needle.length)), r.s.text.slice(r.at + needle.length, to)];
        const tc = M.toTimecode((r.clip?.tcStart || 0) + r.s.start, r.clip?.fps || Page.media.fps);
        return el("li", {},
          el("button", { type: "button", class: "search-result", onclick: () => Page.show("edit", { transcriptId: r.t.id, segment: r.i }) },
            el("span", { class: "search-result-where" }, `${r.t.title} · ${tc} · ${r.name}`),
            el("span", { class: "search-result-text" }, snippet, to < r.s.text.length ? "…" : "")));
      })));
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    // Imports
    $("transcript-import").addEventListener("click", () => $("transcript-input").click());
    $("transcript-input").addEventListener("change", (event) => {
      importTranscriptFiles([...event.target.files]);
      event.target.value = "";
    });
    $("markers-import").addEventListener("click", () => $("markers-input").click());
    $("markers-input").addEventListener("change", (event) => {
      importMarkerFiles([...event.target.files]);
      event.target.value = "";
    });
    $("location-add").addEventListener("click", () => {
      Page.media.locations.push({ id: M.newId("loc"), person: "", footage: "", proxies: "", notes: "" });
      Page.saveMedia();
      renderLocations();
      $("location-table").querySelector("tbody tr:last-child input")?.focus();
    });
    $("timeline-import").addEventListener("click", () => $("timeline-input").click());
    $("timeline-input").addEventListener("change", (event) => {
      if (event.target.files[0]) importTimeline(event.target.files[0]);
      event.target.value = "";
    });

    // Paste dialog
    const dialog = $("paste-dialog");
    $("transcript-paste").addEventListener("click", () => { $("paste-form").reset(); dialog.showModal(); });
    $("paste-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    $("paste-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const transcript = addTranscript(String(data.get("text")), { title: String(data.get("title")).trim() });
      if (!transcript) { alert("Couldn't find any text in that."); return; }
      Page.saveMedia();
      dialog.close();
      renderMedia();
      setStatus(`Added “${transcript.title}” (${plural(transcript.segments.length, "paragraph")})` +
                (transcript.estimated ? ". It had no timecodes, so times are estimated from the word count." : "."));
    });

    // Project frame rate, add clip, search
    $("media-fps").addEventListener("change", (event) => {
      Page.media.fps = Number(event.target.value);
      Page.saveMedia();
      renderMedia();
    });
    $("clip-add").addEventListener("click", () => {
      const name = prompt("Clip name (as it appears in your editor):");
      if (!name?.trim()) return;
      Page.media.clips.push({ id: M.newId("c"), name: name.trim(), duration: 0, tcStart: 0, fps: Page.media.fps, path: "", source: "manual" });
      Page.saveMedia();
      renderMedia();
    });
    $("media-search").addEventListener("input", renderSearch);

    // Tabs (click, or arrow keys between them)
    const tabButtons = [...document.querySelectorAll("#media-tabs [role=tab]")];
    tabButtons.forEach((button, i) => {
      button.addEventListener("click", () => Page.show(button.dataset.tab));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const next = tabButtons[(i + (event.key === "ArrowRight" ? 1 : tabButtons.length - 1)) % tabButtons.length];
        next.focus();
        next.click();
      });
    });

    // Move every transcript at once
    $("transcripts-move-all")?.addEventListener("change", (event) => {
      const choice = event.target.value;
      event.target.value = "";
      const list = Page.media.transcripts.filter(t => M.isLoaded(t));
      if (choice && list.length) moveTranscripts(list, choice);
    });

    // Transcripts kept outside the project: read their words before showing anything
    const start = location.hash.slice(1);
    Promise.all([M.hydrate(Page.media), loadFolders()]).then(([missing]) => {
      $("transcripts-move-all")?.replaceChildren(...placeOptions("").filter(Boolean));
      Page.show(["edit", "export"].includes(start) ? start : "media");
      if (missing.length) setStatus(`Couldn't find the words of ${missing.map(m => `“${m}”`).join(", ")}. See “Stored in” on each transcript.`);
    });
  });
})();
