/* =========================================================
   media-core.js — transcripts, clips, timecode and edits
   ---------------------------------------------------------
   The shared engine for the editing side of the site:
     • Media & Transcripts page (media.js, text-edit.js, timeline-export.js)
     • A/V Script page (av-script.js)
     • Storyboarder (links from frames to blocks in an edit)

   Saved inside the active project:

     project.data.media = {
       fps: 24,                       timecode frame rate for the project
       clips: [{ id, name, duration, tcStart, fps, path, source }],
       transcripts: [{
         id, title, file, clipName,   clipName "" = find the clip by name
         storage: { where, key, folder, path, at, by },   where the words are kept (below)
         storageLog: [{ at, by, where, folder, path }],   every move, oldest first
         paragraphs, length,          counts kept for transcripts stored elsewhere
         speakers: { "S1": "Aisha" }, raw speaker label → display name
         segments: [{ start, end, speaker, text, marks }],
         estimated,                   true if the file had no timecodes
         added,
       }],
     }
     project.data.edits = [{ id, name, created, updated, blocks: [block, ...] }]

   Times are in seconds. Transcript times count from the start of
   the recording; a clip's tcStart (e.g. 01:00:00:00) is added when
   showing or exporting source timecode, which is how transcripts
   "line up" with the clips in an editor's timeline.

   `marks` is an optional list of [character offset, time, ...]
   pairs inside a paragraph (from the caption lines it was built
   from), so a selected phrase gets a close In/Out time.

   A block is one line of the paper edit:
     { id, kind: "soundbite" | "narration" | "broll" | "title" | "section",
       text, seconds,                     (seconds: null = automatic)
       transcriptId, speaker, speakerName, clipName, in, out }   (soundbites)

   WHERE TRANSCRIPTS ARE KEPT
   Transcripts are the biggest thing in a project. Each one's words
   (its segments) can be kept:
     "project"  inside the project, like everything else (shared and
                synced with the project, so long ones slow that down)
     "browser"  in this browser's file storage (FileStore key
                "tx-<id>-<version>", lots of room). Shared files and the sync
                folder carry it like an uploaded file; the key changes
                whenever the words do, so collaborators get the new copy.
     "folder"   as a file in a folder you choose, e.g. a shared Google
                Drive folder: <folder>/Cobbler transcripts/<project>/<title> [id].json,
                with a copy in file storage so it opens straight away.
   The rest of the transcript (name, speakers, clip) stays in the
   project. loadMedia() fills in the words from memory once
   hydrate() has read them; packMedia() takes them out again for
   saving. Every move is logged in storageLog.

   Needs projects-core.js (and file-store.js for moved transcripts).
   ========================================================= */
(() => {

  /* =========================================================
     SETTINGS
     ========================================================= */

  const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  const DEFAULT_FPS = 24;
  const WORDS_PER_SECOND = 2.5;   // about 150 words a minute, for narration and untimed transcripts

  const KINDS = {
    soundbite: { name: "Soundbite", defaultSeconds: 0 },
    narration: { name: "Narration", defaultSeconds: null },   // from the word count
    broll:     { name: "B-roll",    defaultSeconds: 5 },
    title:     { name: "Title",     defaultSeconds: 4 },
    section:   { name: "Section",   defaultSeconds: 0 },
  };


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const newId = Cobbler.newId;
  const wordCount = (text) => (text.trim().match(/\S+/g) || []).length;

  // "Interview_Aisha_01.mov" → "interviewaisha01" (for matching names)
  const nameKey = (name) => String(name || "").toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(/[^a-z0-9]/g, "");

  // Snaps 23.98, 23.976023… to the nearest known frame rate
  function snapFps(fps) {
    if (!(fps > 0)) return DEFAULT_FPS;
    return FRAME_RATES.reduce((best, f) => Math.abs(f - fps) < Math.abs(best - fps) ? f : best, FRAME_RATES[0]);
  }

  // Frames per timecode second: 23.976 counts in 24s, 29.97 in 30s
  const timebase = (fps) => Math.round(fps);


  /* =========================================================
     TIMECODE (non-drop frame)
     ========================================================= */

  /* 3723.5 seconds at 24 fps → "01:02:03:12" */
  function toTimecode(seconds, fps = DEFAULT_FPS) {
    const base = timebase(fps);
    let frames = Math.max(0, Math.round(seconds * fps));
    const f = frames % base; frames = (frames - f) / base;
    const s = frames % 60;  frames = (frames - s) / 60;
    const m = frames % 60;
    const h = (frames - m) / 60;
    return [h, m, s, f].map(n => String(n).padStart(2, "0")).join(":");
  }

  /* "01:02:03:12", "1:02:03", "02:03", "12.5s" → seconds (null if unreadable) */
  function fromTimecode(text, fps = DEFAULT_FPS) {
    const t = String(text).trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?s$/.test(t)) return parseFloat(t);
    const parts = t.split(/[:;.]/).map(p => p.trim());
    if (!parts.every(p => /^\d{1,3}$/.test(p))) return null;
    const n = parts.map(Number);
    const base = timebase(fps);
    let frames;
    if (n.length === 4) frames = ((n[0] * 60 + n[1]) * 60 + n[2]) * base + n[3];
    else if (n.length === 3) frames = ((n[0] * 60 + n[1]) * 60 + n[2]) * base;
    else if (n.length === 2) frames = (n[0] * 60 + n[1]) * base;
    else return null;
    return frames / fps;
  }

  /* Short running times: 83 → "1:23", 3723 → "1:02:03" */
  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }


  /* =========================================================
     READING TRANSCRIPTS (.srt, .vtt, .txt, pasted text)
     ========================================================= */

  // "01:02:03,450", "02:03.450", "1:02:03", "01:02:03:12" (frames, e.g. from Resolve) → seconds
  function captionTime(text, fps = DEFAULT_FPS) {
    const t = String(text).trim();
    const tc = t.match(/^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/);
    if (tc) return ((Number(tc[1]) * 60 + Number(tc[2])) * 60 + Number(tc[3])) + Number(tc[4]) / timebase(fps);
    const m = t.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return null;
    const ms = m[4] ? Number(m[4].padEnd(3, "0")) / 1000 : 0;
    return (Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3]) + ms;
  }

  // Removes formatting tags like <i> and {\an8}
  const stripTags = (text) => text.replace(/<[^>]+>/g, "").replace(/\{\\[^}]*\}/g, "").replace(/\s+/g, " ").trim();

  /* "SAM: Hello" or ">> Sam Rivera: Hello" → { speaker: "SAM", text: "Hello" }.
     Names are 1–3 words and start with a capital, so "Note: …" style text
     mid-sentence is rare to misread. */
  function splitSpeaker(text) {
    // "[Speaker 1] Hello" (DaVinci Resolve and others)
    const bracket = text.match(/^\[([^\]\d][^\]]{0,39})\]\s*(.+)$/);
    if (bracket) return { speaker: bracket[1].trim(), text: bracket[2] };
    const m = text.match(/^(?:>>\s*|-\s+)?([A-Z][\w.'’-]*(?: [A-Z0-9][\w.'’-]*){0,2}):\s+(.+)$/);
    return m ? { speaker: m[1], text: m[2] } : { speaker: null, text: text.replace(/^>>\s*/, "") };
  }

  /* Caption cues → paragraphs. Neighbouring cues by the same speaker
     join up (short gaps, up to ~400 characters), keeping each cue's
     start as a mark so selections inside the paragraph stay accurate. */
  function cuesToSegments(cues) {
    const segments = [];
    let current = null;
    let speaker = null;

    cues.forEach(cue => {
      const split = splitSpeaker(cue.text);
      const newSpeaker = cue.speaker || split.speaker;
      const text = cue.speaker ? cue.text : split.text;
      if (!text) return;
      const changed = newSpeaker && newSpeaker !== speaker;
      if (newSpeaker) speaker = newSpeaker;

      const join = current && !changed && cue.start - current.end < 1.5 && current.text.length + text.length < 400;
      if (join) {
        current.marks.push(current.text.length + 1, cue.start);
        current.text += " " + text;
        current.end = cue.end;
      } else {
        current = { start: cue.start, end: cue.end, speaker: speaker || "", text, marks: [] };
        segments.push(current);
      }
    });
    segments.forEach(s => { if (!s.marks.length) delete s.marks; });
    return segments;
  }

  function parseSRT(text) {
    const cues = [];
    text.replace(/\r/g, "").split(/\n\s*\n/).forEach(block => {
      const lines = block.split("\n").filter(l => l.trim());
      const at = lines.findIndex(l => l.includes("-->"));
      if (at < 0) return;
      const [a, b] = lines[at].split("-->").map(s => captionTime(s.trim().split(/\s+/)[0]));
      if (a == null || b == null) return;
      cues.push({ start: a, end: b, text: stripTags(lines.slice(at + 1).join(" ")) });
    });
    return cuesToSegments(cues);
  }

  function parseVTT(text) {
    const cues = [];
    text.replace(/\r/g, "").split(/\n\s*\n/).forEach(block => {
      const lines = block.split("\n").filter(l => l.trim());
      const at = lines.findIndex(l => l.includes("-->"));
      if (at < 0) return;   // WEBVTT header, NOTE, STYLE, REGION
      const [a, b] = lines[at].split("-->").map(s => captionTime(s.trim().split(/\s+/)[0]));
      if (a == null || b == null) return;
      const raw = lines.slice(at + 1).join(" ");
      const voice = raw.match(/<v(?:\.[\w.]+)?\s+([^>]+)>/);   // <v Sam Rivera>Hello</v>
      cues.push({ start: a, end: b, speaker: voice ? voice[1].trim() : null, text: stripTags(raw) });
    });
    return cuesToSegments(cues);
  }

  /* Plain text from transcription services, e.g.
       [00:01:23] Sam: Hello there            (Descript, many others)
       Sam Rivera  0:03                       (Otter: name and time, text below)
       Speaker 1 (00:03):                     (Rev)
       00:01:23 / text on the next lines
     Text with no timecodes at all is split into paragraphs and timed
     from the word count (marked as estimated). */
  function parseTXT(text) {
    const TC = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3}|[:;]\d{2})?`;
    const NAME = String.raw`[A-Za-z][\w.'’ -]{0,40}?`;
    const timeFirst = new RegExp(String.raw`^\s*[\[(]?(${TC})[\])]?\s*(?:[-–—|]\s*)?(?:(${NAME})\s*:\s*)?(.*)$`);
    const nameFirst = new RegExp(String.raw`^\s*(${NAME})\s*[\[(]?(${TC})[\])]?\s*:?\s*$`);
    const nameOnly = /^\s*([A-Z][\w.'’-]*(?: [A-Z0-9][\w.'’-]*){0,2}):\s+(.+)$/;
    // "00:00:01:12 - 00:00:05:03" or "00:01.000 --> 00:04.000" (a time range, text after or below)
    const range = new RegExp(String.raw`^\s*[\[(]?(${TC})\s*(?:-->|[-–—]|to)\s*(${TC})[\])]?\s*(.*)$`);
    // A line that's only a speaker label, e.g. "Speaker 1" or "SAM RIVERA" (DaVinci Resolve puts these above the text)
    const speakerLine = /^\s*(Speaker \d{1,2}|[A-Z][A-Z.'’-]+(?: [A-Z][A-Z.'’-]+){0,2})\s*:?\s*$/;

    const segments = [];
    let current = null;
    let speaker = "";
    const start = (time, who, line) => {
      if (who) speaker = who.trim();
      current = { start: time, end: null, speaker, text: line ? line.trim() : "" };
      segments.push(current);
    };

    text.replace(/\r/g, "").split("\n").forEach(line => {
      if (!line.trim()) { if (current && current.text) current.closed = true; return; }
      let m;
      if ((m = line.match(range)) && captionTime(m[1]) != null) {
        start(captionTime(m[1]), null, m[3]);
        current.rangeEnd = captionTime(m[2]);
        return;
      }
      // (capitals-only names count only straight after a time, so shouted lines stay text)
      if ((m = line.match(speakerLine)) && (/^Speaker \d/.test(m[1]) || (current && !current.text))) {
        speaker = m[1].trim();
        if (current && !current.text) current.speaker = speaker;
        return;
      }
      if ((m = line.match(nameFirst))) return start(captionTime(m[2]), m[1], "");
      if ((m = line.match(timeFirst)) && captionTime(m[1]) != null) return start(captionTime(m[1]), m[2], m[3]);
      if ((m = line.match(nameOnly))) return start(null, m[1], m[2]);
      if (!current || current.closed) return start(null, null, line);
      current.text += (current.text ? " " : "") + line.trim();
    });

    const list = segments.filter(s => s.text);
    list.forEach(s => {
      delete s.closed;
      if (s.rangeEnd != null && s.rangeEnd > s.start) s.end = s.rangeEnd;
      delete s.rangeEnd;
    });
    const estimated = !list.some(s => s.start != null);

    // Fill in missing times: carry on from the previous paragraph at speaking pace
    let clock = 0;
    list.forEach((s, i) => {
      if (s.start == null) s.start = clock;
      const next = list.slice(i + 1).find(n => n.start != null);
      const spoken = Math.max(1, wordCount(s.text) / WORDS_PER_SECOND);
      if (s.end != null) { clock = s.end; return; }   // the file gave an end time
      s.end = next && next.start > s.start ? Math.min(next.start, s.start + Math.max(spoken, next.start - s.start)) : s.start + spoken;
      clock = s.end;
    });
    return { segments: list, estimated };
  }

  /* Reads any supported transcript. `name` (file name) helps pick the format.
     Subtitles exported from a DaVinci Resolve timeline usually start at the
     timeline's start, 01:00:00:00. If every time is an hour or more in, the
     whole hours are taken off so the transcript starts near 00:00 like the
     recording it came from (`shifted` says by how much). */
  function parseTranscript(text, name = "") {
    const ext = name.toLowerCase().split(".").pop();
    const body = text.replace(/^﻿/, "");
    let result;
    if (ext === "vtt" || /^WEBVTT/.test(body)) result = { segments: parseVTT(body), estimated: false, format: "vtt" };
    else if (ext === "srt" || /\d\s*-->\s*\d/.test(body)) result = { segments: parseSRT(body), estimated: false, format: "srt" };
    else result = { ...parseTXT(body), format: "txt" };

    const first = result.segments[0]?.start ?? 0;
    const hours = result.estimated ? 0 : Math.floor(first / 3600);
    result.shifted = 0;
    if (hours >= 1) {
      result.shifted = hours * 3600;
      shiftSegments(result.segments, -result.shifted);
    }
    return result;
  }

  /* Moves every time in a transcript's paragraphs by `seconds` (can be negative) */
  function shiftSegments(segments, seconds) {
    segments.forEach(s => {
      s.start = Math.max(0, s.start + seconds);
      s.end = Math.max(s.start, s.end + seconds);
      if (s.marks) for (let i = 1; i < s.marks.length; i += 2) s.marks[i] = Math.max(0, s.marks[i] + seconds);
    });
  }


  /* =========================================================
     DAVINCI RESOLVE MARKERS (.edl or .csv)
     In Resolve: right-click the timeline in the Media Pool ›
     Timelines › Export › Timeline Markers to EDL…, or the Edit
     Index (markers view) › ⋯ › Export to CSV.
     ========================================================= */

  /* Resolve's marker colours, with a hex value for showing them here */
  const MARKER_COLORS = {
    Blue: "#3D7FF5", Cyan: "#2FD5E0", Green: "#3CB043", Yellow: "#F2D21B", Red: "#E8413C", Pink: "#F49AC2",
    Purple: "#9254DE", Fuchsia: "#D12E8A", Rose: "#F6A5A5", Lavender: "#B9A5F0", Sky: "#9ED9F0", Mint: "#9DE5C2",
    Lemon: "#EEF07A", Sand: "#C9A86A", Cocoa: "#7E5A3C", Cream: "#F2E8C9",
  };
  const colorName = (raw) => {
    const name = String(raw || "").replace(/^ResolveColor/i, "").trim();
    return Object.keys(MARKER_COLORS).find(c => c.toLowerCase() === name.toLowerCase()) || (name ? name[0].toUpperCase() + name.slice(1).toLowerCase() : "Blue");
  };

  /* A small CSV reader (quoted fields, commas and new lines inside quotes) */
  function readCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(f => f.trim()));
  }

  /* Reads markers. Returns { markers: [{ at, duration, color, name, note }], fps, format }
     with `at` in seconds of timeline timecode (e.g. 3605 = 01:00:05:00). */
  function parseMarkers(text, fileName = "", fps = DEFAULT_FPS) {
    const body = text.replace(/^﻿/, "").replace(/\r/g, "");
    const markers = [];

    // EDL: an event line, then " |C:ResolveColorBlue |M:Name |D:1" (or Avid-style "* LOC:" lines)
    if (/^\s*(TITLE:|FCM:|\d{3,})/m.test(body) && /(\|M:|\* ?LOC:)/.test(body)) {
      let lastRecord = null;
      body.split("\n").forEach(line => {
        const event = line.match(/^\s*\d+\s+\S+\s+\S+\s+\S+\s+([\d:;]{11})\s+([\d:;]{11})\s+([\d:;]{11})\s+([\d:;]{11})/);
        if (event) { lastRecord = fromTimecode(event[3], fps); return; }
        const resolve = line.match(/\|C:\s*([^|]*?)\s*\|M:\s*(.*?)\s*(?:\|D:\s*(\d+))?\s*$/);
        if (resolve && lastRecord != null) {
          const nameAndNote = resolve[2].split(/\s*\|N:\s*/);
          markers.push({ at: lastRecord, duration: Number(resolve[3] || 1) / fps, color: colorName(resolve[1]),
                         name: nameAndNote[0].trim(), note: (nameAndNote[1] || "").trim() });
          return;
        }
        const loc = line.match(/^\*\s?LOC:\s*([\d:;]{11})\s+(\w+)\s*(.*)$/);
        if (loc) markers.push({ at: fromTimecode(loc[1], fps), duration: 0, color: colorName(loc[2]), name: loc[3].trim(), note: "" });
        const comment = line.match(/^\*\s?COMMENT:\s*(.*)$/);
        if (comment && markers.length) markers[markers.length - 1].note = comment[1].trim();
      });
      return { markers: markers.filter(m => m.at != null), fps, format: "EDL" };
    }

    // CSV: find the columns by their names
    const rows = readCSV(body);
    if (rows.length > 1) {
      const head = rows[0].map(h => h.trim().toLowerCase());
      const col = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
      const at = [col("record in"), col("timecode"), col("start"), col("source in"), col("in")].find(i => i >= 0) ?? -1;
      const name = col("name", "marker"), note = col("notes", "note", "comment", "description"), color = col("color", "colour");
      const duration = col("duration");
      if (at >= 0) {
        rows.slice(1).forEach(r => {
          const time = fromTimecode(r[at] || "", fps);
          if (time == null) return;
          const d = r[duration] ? (fromTimecode(r[duration], fps) ?? Number(r[duration]) / fps) : 0;
          markers.push({ at: time, duration: d || 0, color: colorName(r[color]), name: (r[name] || "").trim(), note: (r[note] || "").trim() });
        });
        return { markers, fps, format: "CSV" };
      }
    }
    throw new Error(`no markers found in ${fileName || "the file"}. Export them from Resolve as an EDL (Timeline Markers to EDL) or a CSV from the Edit Index`);
  }


  /* =========================================================
     READING TIMELINES (FCPXML from Final Cut / Resolve, XML from Premiere)
     ========================================================= */

  // "1001/24000s" → 0.0417, "10s" → 10
  function rational(value) {
    const m = String(value || "").match(/^(-?\d+)(?:\/(\d+))?s$/);
    return m ? Number(m[1]) / Number(m[2] || 1) : 0;
  }

  const fileName = (src) => {
    try { return decodeURIComponent(String(src).split(/[\\/]/).pop()); } catch { return String(src).split(/[\\/]/).pop(); }
  };

  function parseFCPXML(doc) {
    const formats = {};
    doc.querySelectorAll("format").forEach(f => {
      const frame = rational(f.getAttribute("frameDuration"));
      if (frame) formats[f.getAttribute("id")] = snapFps(1 / frame);
    });
    const sequenceFormat = doc.querySelector("sequence")?.getAttribute("format");
    const fallbackFps = formats[sequenceFormat] || Object.values(formats)[0] || DEFAULT_FPS;

    let clips = [...doc.querySelectorAll("asset")].map(asset => {
      const src = asset.querySelector("media-rep")?.getAttribute("src") || asset.getAttribute("src") || "";
      return {
        name: asset.getAttribute("name") || fileName(src),
        duration: rational(asset.getAttribute("duration")),
        tcStart: rational(asset.getAttribute("start")),
        fps: formats[asset.getAttribute("format")] || fallbackFps,
        path: src,
      };
    });
    // Older files without assets: use the clips in the timeline
    if (!clips.length) {
      clips = [...doc.querySelectorAll("asset-clip, clip")].map(c => ({
        name: c.getAttribute("name") || "", duration: rational(c.getAttribute("duration")),
        tcStart: 0, fps: fallbackFps, path: "",
      }));
    }
    return { clips, fps: fallbackFps };
  }

  // A direct child element's text, e.g. child(file, "name")
  const child = (node, tag) => [...(node?.children || [])].find(c => c.tagName === tag);
  const childText = (node, tag) => child(node, tag)?.textContent.trim() || "";

  function rateOf(node) {
    const rate = child(node, "rate");
    const base = Number(childText(rate, "timebase")) || 0;
    if (!base) return null;
    return snapFps(childText(rate, "ntsc").toUpperCase() === "TRUE" ? base * 1000 / 1001 : base);
  }

  function parseXMEML(doc) {
    const sequence = doc.querySelector("sequence");
    const seqFps = rateOf(sequence) || DEFAULT_FPS;
    const seen = new Map();

    doc.querySelectorAll("file").forEach(file => {
      const name = childText(file, "name");
      if (!name) return;   // later mentions of a file only carry its id
      const id = file.getAttribute("id") || name;
      if (seen.has(id)) return;
      const fps = rateOf(file) || seqFps;
      const tc = child(file, "timecode");
      const tcString = childText(tc, "string");
      const tcFrame = Number(childText(tc, "frame"));
      seen.set(id, {
        name,
        duration: (Number(childText(file, "duration")) || 0) / fps,
        tcStart: tcString ? fromTimecode(tcString, fps) || 0 : (tcFrame ? tcFrame / fps : 0),
        fps,
        path: childText(file, "pathurl"),
      });
    });

    let clips = [...seen.values()];
    if (!clips.length) {
      clips = [...doc.querySelectorAll("clipitem")].map(c => ({
        name: childText(c, "name"), duration: 0, tcStart: 0, fps: rateOf(c) || seqFps, path: "",
      })).filter(c => c.name);
    }
    return { clips, fps: seqFps };
  }

  /* Reads an editor's timeline file. Returns { clips, fps, format } or throws a readable error. */
  function parseTimeline(text) {
    const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ""), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("this file isn't valid XML");
    const root = doc.documentElement.tagName;
    if (root === "fcpxml") return { ...parseFCPXML(doc), format: "FCPXML" };
    if (root === "xmeml") return { ...parseXMEML(doc), format: "Premiere XML" };
    throw new Error("expected FCPXML (Final Cut, Resolve) or XML from Premiere");
  }


  /* =========================================================
     PROJECT DATA
     ========================================================= */

  function loadMedia() {
    const m = Projects.getData("media", {});
    let media = (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
    media.fps = FRAME_RATES.includes(media.fps) ? media.fps : DEFAULT_FPS;
    media.clips = Array.isArray(media.clips) ? media.clips : [];
    media.transcripts = Array.isArray(media.transcripts) ? media.transcripts : [];
    media.transcripts.forEach(t => {
      t.speakers ||= {};
      t.segments = Array.isArray(t.segments) ? t.segments : [];
      t.clipName ??= "";
    });
    // Transcripts kept elsewhere: a copy with their words filled in, so the
    // stored project never takes them back in (packMedia() takes them out to save)
    if (media.transcripts.some(isExternal)) {
      media = { ...media, transcripts: media.transcripts.map(t => isExternal(t) ? { ...t, segments: wordsCache.get(t.id) || [] } : t) };
    }
    return media;
  }


  /* =========================================================
     WHERE TRANSCRIPTS ARE KEPT (see the top of this file)
     ========================================================= */

  const wordsCache = new Map();   // transcript id → segments, once read
  const isExternal = (t) => !!t?.storage && t.storage.where !== "project";
  const isLoaded = (t) => !isExternal(t) || wordsCache.has(t.id);
  const FOLDER_HANDLE = "transcripts-folder-handle";
  const fileStore = () => window.FileStore || null;

  // The media as it's saved: transcripts kept elsewhere without their words
  function packMedia(media) {
    return { ...media, transcripts: media.transcripts.map(t => isExternal(t) ? { ...t, segments: [] } : t) };
  }

  const safeName = (text) => String(text || "Untitled").replace(/[\\/:*?"<>|[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled";
  const folderPath = (t) => ["Cobbler transcripts", `${safeName(Projects.activeName())} [${Projects.activeId()}]`, `${safeName(t.title)} [${t.id}].json`];

  async function folderHandle(ask = false) {
    const fs = fileStore();
    if (!fs) return null;
    let handle = null;
    try { handle = await fs.get(FOLDER_HANDLE); } catch {}
    if (!handle) return null;
    try {
      if (await handle.queryPermission({ mode: "readwrite" }) === "granted") return handle;
      if (ask && await handle.requestPermission({ mode: "readwrite" }) === "granted") return handle;
    } catch {}
    return null;
  }

  async function readFolderFile(t) {
    const root = await folderHandle(false);
    if (!root || !t.storage?.path) return null;
    try {
      let dir = root;
      const parts = t.storage.path.split("/");
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      const file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
      return JSON.parse(await file.text()).segments || null;
    } catch { return null; }
  }

  /* Reads the words of transcripts kept elsewhere into memory. Returns the titles it couldn't find. */
  async function hydrate(media = null) {
    const list = (media || loadMedia()).transcripts.filter(t => isExternal(t) && !wordsCache.has(t.id));
    const missing = [];
    for (const t of list) {
      let segments = null;
      try {
        const blob = await fileStore()?.get(t.storage.key);
        if (blob) segments = JSON.parse(await blob.text()).segments || null;
      } catch {}
      if (!segments && t.storage.where === "folder") {
        segments = await readFolderFile(t);
        if (segments) await keepCopy(t, segments);   // so it opens straight away next time
      }
      if (segments) wordsCache.set(t.id, segments); else missing.push(t.title);
    }
    if (media) media.transcripts.forEach(t => { if (isExternal(t) && wordsCache.has(t.id)) t.segments = wordsCache.get(t.id); });
    return missing;
  }

  const newKey = (t) => `tx-${t.id}-${Date.now().toString(36)}`;
  const payload = (t, segments) => JSON.stringify({
    app: "cobbler-project", kind: "transcript", version: 1, id: t.id, title: t.title, project: Projects.activeName(),
    speakers: t.speakers || {}, segments, saved: Date.now(),
  });

  async function keepCopy(t, segments) {
    const fs = fileStore();
    if (!fs) throw new Error("file storage isn't available on this page");
    await fs.put(t.storage.key, new Blob([payload(t, segments)], { type: "application/json" }));
  }

  async function writeFolderFile(root, t, segments) {
    const parts = folderPath(t);
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
    const stream = await handle.createWritable();
    await stream.write(payload(t, segments));
    await stream.close();
    return parts.join("/");
  }

  /* Moves a transcript's words to "project", "browser" or "folder" (root: a folder handle).
     Updates t (in the page's media) and logs where it went; the caller saves the media. */
  async function moveTranscript(t, where, { root = null } = {}) {
    const segments = isExternal(t) ? (wordsCache.get(t.id) || t.segments) : t.segments;
    if (!segments?.length && isExternal(t) && !wordsCache.has(t.id)) throw new Error(`the words of “${t.title}” aren't loaded, so it can't be moved`);
    const oldKey = t.storage?.key;
    const key = newKey(t);
    const by = Projects.me() || "Someone";
    t.paragraphs = segments.length;
    t.length = segments.length ? segments[segments.length - 1].end - segments[0].start : 0;
    let entry;
    if (where === "project") {
      t.segments = segments;
      entry = { where: "project" };
      wordsCache.delete(t.id);
    } else if (where === "browser") {
      t.storage = { where: "browser", key };
      await keepCopy(t, segments);
      entry = { where: "browser", key };
    } else if (where === "folder") {
      if (!root) throw new Error("choose a folder first");
      const path = await writeFolderFile(root, t, segments);
      t.storage = { where: "folder", key, folder: root.name, path };
      await keepCopy(t, segments);
      entry = { where: "folder", key, folder: root.name, path };
    } else throw new Error(`unknown place “${where}”`);
    if (oldKey && oldKey !== key) { try { await fileStore()?.remove(oldKey); } catch {} }
    const stamp = { at: Date.now(), by };
    if (where === "project") { delete t.storage; } else { Object.assign(t.storage, stamp); wordsCache.set(t.id, segments); t.segments = segments; }
    t.storageLog = [...(Array.isArray(t.storageLog) ? t.storageLog : []), { ...stamp, where: entry.where, folder: entry.folder || "", path: entry.path || "" }];
    return t;
  }

  /* After changing a stored transcript's words (e.g. Shift times): write them back where they live */
  async function saveStoredWords(t) {
    if (!isExternal(t)) return;
    wordsCache.set(t.id, t.segments);
    const oldKey = t.storage.key;
    t.storage.key = newKey(t);
    await keepCopy(t, t.segments);
    try { await fileStore()?.remove(oldKey); } catch {}
    if (t.storage.where === "folder") {
      const root = await folderHandle(true);
      if (root) await writeFolderFile(root, t, t.segments);
    }
  }

  async function forgetStoredWords(t) {
    if (!isExternal(t)) return;
    wordsCache.delete(t.id);
    try { await fileStore()?.remove(t.storage.key); } catch {}
  }

  // On every page that has media-core.js: read moved transcripts' words in the background
  // (e.g. for the Writing page's quote checker), then say so
  document.addEventListener("DOMContentLoaded", () => {
    if (!window.Projects?.getData) return;
    if (!loadMedia().transcripts.some(t => isExternal(t) && !wordsCache.has(t.id))) return;
    hydrate().then(() => document.dispatchEvent(new Event("transcripts-loaded")));
  });

  // "This browser's file storage" / "Google Drive › Cobbler transcripts › …"
  function describeStorage(entry) {
    if (!entry || entry.where === "project") return "Inside the project";
    if (entry.where === "browser") return "This browser's file storage";
    return `Folder “${entry.folder}” › ${String(entry.path || "").split("/").join(" › ")}`;
  }

  function loadEdits() {
    const edits = Projects.getData("edits", []);
    return Array.isArray(edits) ? edits.filter(e => e && Array.isArray(e.blocks)) : [];
  }

  /* The clip a transcript belongs to: the one picked, or one whose
     name matches the transcript's (file) name */
  function clipFor(media, transcript) {
    if (!transcript) return null;
    if (transcript.clipName) return media.clips.find(c => c.name === transcript.clipName) || null;
    const keys = [nameKey(transcript.title), nameKey(transcript.file)].filter(Boolean);
    return media.clips.find(c => keys.includes(nameKey(c.name)))
        || media.clips.find(c => keys.some(k => k.length > 3 && (nameKey(c.name).includes(k) || k.includes(nameKey(c.name)))))
        || null;
  }

  const speakerName = (transcript, raw) => (transcript?.speakers?.[raw] || raw || "Unknown").trim();

  /* Time inside a paragraph at a character offset (uses the caption marks when there are some) */
  function timeAt(segment, offset) {
    const length = Math.max(1, segment.text.length);
    const points = [[0, segment.start]];
    const marks = segment.marks || [];
    for (let i = 0; i < marks.length; i += 2) points.push([marks[i], marks[i + 1]]);
    points.push([length, segment.end]);
    const o = Math.min(Math.max(0, offset), length);
    for (let i = 1; i < points.length; i++) {
      const [o0, t0] = points[i - 1], [o1, t1] = points[i];
      if (o <= o1) return o1 === o0 ? t0 : t0 + (t1 - t0) * (o - o0) / (o1 - o0);
    }
    return segment.end;
  }

  /* Character offset inside a paragraph for a time (the reverse of timeAt) */
  function offsetAt(segment, time) {
    const length = segment.text.length;
    if (time <= segment.start) return 0;
    if (time >= segment.end) return length;
    let lo = 0, hi = length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeAt(segment, mid) < time) lo = mid + 1; else hi = mid;
    }
    return lo;
  }


  /* =========================================================
     BLOCKS (paper edit lines)
     ========================================================= */

  function newBlock(kind, fields = {}) {
    return { id: newId("k"), kind, text: "", seconds: null, ...fields };
  }

  /* How long a block runs */
  function blockSeconds(block) {
    if (block.kind === "soundbite") return Math.max(0, (block.out ?? 0) - (block.in ?? 0));
    if (block.kind === "section") return 0;
    if (block.seconds != null && block.seconds !== "" && Number(block.seconds) >= 0) return Number(block.seconds);
    if (block.kind === "narration") return Math.max(1, Math.round(wordCount(block.text) / WORDS_PER_SECOND * 10) / 10);
    return KINDS[block.kind]?.defaultSeconds || 0;
  }

  /* The clip and source timecode a soundbite points at */
  function sourceOf(media, block) {
    const transcript = media.transcripts.find(t => t.id === block.transcriptId) || null;
    const clip = transcript ? clipFor(media, transcript) : media.clips.find(c => c.name === block.clipName) || null;
    const fps = clip?.fps || media.fps;
    const offset = clip?.tcStart || 0;
    return {
      transcript, clip, fps,
      clipName: clip?.name || block.clipName || transcript?.title || "Unknown clip",
      sourceIn: offset + (block.in || 0),
      sourceOut: offset + (block.out || 0),
    };
  }

  /* Running time: total, and per speaker / kind */
  function runningTimes(media, blocks) {
    const per = new Map();
    let total = 0;
    blocks.forEach(block => {
      const seconds = blockSeconds(block);
      total += seconds;
      if (!seconds) return;
      let label = KINDS[block.kind].name;
      if (block.kind === "soundbite") {
        const transcript = media.transcripts.find(t => t.id === block.transcriptId);
        label = transcript ? speakerName(transcript, block.speaker) : (block.speakerName || "Unknown");
      }
      per.set(label, (per.get(label) || 0) + seconds);
    });
    return { total, per: [...per.entries()].sort((a, b) => b[1] - a[1]) };
  }

  /* Short description of a block, e.g. for menus: "Soundbite · Sam: “We knew…”" */
  function blockSummary(media, block, max = 60) {
    const cut = (t) => t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
    if (block.kind === "soundbite") {
      const transcript = media.transcripts.find(t => t.id === block.transcriptId);
      const who = transcript ? speakerName(transcript, block.speaker) : (block.speakerName || "Unknown");
      return `Soundbite · ${who}: “${cut(block.text)}”`;
    }
    return `${KINDS[block.kind].name}${block.text ? ` · ${cut(block.text)}` : ""}`;
  }


  /* ---------- Starter structures for an empty paper edit ---------- */

  const STRUCTURES = {
    threeActs: {
      name: "Three acts",
      sections: ["Act one: the setup", "Act two: the conflict", "Act three: the resolution"],
    },
    investigation: {
      name: "Investigation",
      sections: ["Cold open", "The question", "How we found out", "The evidence", "The other side", "What happens now"],
    },
    profile: {
      name: "Character profile",
      sections: ["Meet them", "Where they come from", "What they want", "What stands in the way", "Where they are now"],
    },
    explainer: {
      name: "Explainer",
      sections: ["The hook", "What's happening", "Why it matters", "How it works", "What's next"],
    },
  };


  /* ---------- Let other scripts use the engine ---------- */
  window.MediaCore = {
    FRAME_RATES, KINDS, STRUCTURES, WORDS_PER_SECOND,
    newId, nameKey, snapFps, wordCount,
    toTimecode, fromTimecode, formatDuration,
    parseTranscript, parseTimeline, shiftSegments, parseMarkers, MARKER_COLORS,
    packMedia, hydrate, moveTranscript, saveStoredWords, forgetStoredWords, describeStorage, isExternal, isLoaded, folderHandle, FOLDER_HANDLE,
    loadMedia, loadEdits, clipFor, speakerName, timeAt, offsetAt,
    newBlock, blockSeconds, sourceOf, runningTimes, blockSummary,
  };
})();
