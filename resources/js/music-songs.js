/* =========================================================
   music-songs.js — the Songs tab (song sketchbook) of the Music page
   ---------------------------------------------------------
   Each song has four parts:
   • Lyrics and chords: write chords in square brackets right
     where they change, e.g. "[G]Walking down the [C]road", and
     sections as a line on their own, e.g. "[Verse 1]". The
     preview shows chords above the words, with syllables per
     line. Transpose up or down a semitone.
   • Sheet music: drawn by abcjs from ABC notation (a plain-text
     way of writing music). Notes and rests are placed by clicking
     on the staff after picking a tool, a length and an accidental;
     a click on a note selects it to move, relength or delete. The
     ABC text sits under the score for typing, and is what's saved.
     A MIDI keyboard can play notes in (Web MIDI), each sounding as it goes in.
     Play it back (needs the internet for the instrument sounds).
   • Split sheet: who wrote what share, their performing rights
     organisation and IPI number, publisher, and whether they've
     signed. Export as a PDF to sign.
   • Sessions and versions: recording sessions, and each version
     (demo, mix v1…) with an audio file or link and notes pinned
     to times in the track.
   Export lyrics and chords, sheet music, or both, as a PDF.

     project.data.songs = [{ id, title, status, key, tempo, time, length, lyrics, abc, notes,
       splits: [{ id, name, role, share, pro, ipi, publisher, email, signed, signedOn }],
       sessions: [{ id, date, place, people, recorded, notes }],
       versions: [{ id, name, date, file, link, status, notes: [{ id, at, text, by }] }] }]

   Needs music-core.js and abcjs (resources/vendor/abcjs).
   ========================================================= */
(() => {

  const M = window.MusicPage;
  if (!M) return;
  const { el, newId } = M;

  const STATUSES = ["Idea", "Writing", "Demo", "Recording", "Mixing", "Mastered", "Released"];
  const ROLES = ["Lyrics and music", "Lyrics", "Music", "Production", "Arrangement"];
  const PROS = ["", "ASCAP", "BMI", "SESAC", "GMR", "SOCAN", "PRS", "APRA AMCOS", "GEMA", "SACEM", "Other", "None"];
  const VERSION_STATUSES = ["Rough", "For feedback", "Approved", "Final"];
  const KEYS = ["", "C", "C#", "Db", "D", "Eb", "E", "F", "F#", "Gb", "G", "Ab", "A", "Bb", "B",
                "Cm", "C#m", "Dm", "D#m", "Ebm", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "Bbm", "Bm"];
  const TIMES = ["4/4", "3/4", "6/8", "2/4", "5/4", "7/8", "12/8"];

  let currentId = null;
  let part = "lyrics";    // "lyrics" | "sheet" | "splits" | "sessions"
  let statusFilter = "";
  let search = "";

  const songs = () => M.list("songs");
  const saveSongs = (list) => M.saveList("songs", list);
  let saveTimer = 0, pending = null;
  const saveSoon = (list) => { pending = list; clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveTimer = 0; pending = null; saveSongs(list); }, 500); };
  // Anything still waiting is saved before the page is left (or an undo)
  window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; const list = pending; pending = null; saveSongs(list); } });

  function normalize(s) {
    for (const k of ["title", "key", "time", "length", "lyrics", "abc", "notes"]) s[k] ??= "";
    s.status = STATUSES.includes(s.status) ? s.status : "Idea";
    s.tempo = s.tempo ?? "";
    for (const k of ["splits", "sessions", "versions"]) s[k] = Array.isArray(s[k]) ? s[k] : [];
    s.versions.forEach(v => { v.notes = Array.isArray(v.notes) ? v.notes : []; });
    return s;
  }


  /* =========================================================
     CHORDS
     ========================================================= */

  const CHORD = /^(?:N\.?C\.?|[A-G](?:#|b)?(?:maj|min|m|dim|aug|sus|add|M|°|ø|\+)?\d*(?:(?:add|sus|maj|b|#|no)\d+)*(?:\([^)]*\))?(?:\/[A-G](?:#|b)?)?)$/;
  const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const noteIndex = (n) => Math.max(SHARPS.indexOf(n), FLATS.indexOf(n));

  function transposeNote(note, steps, useFlats) {
    const i = noteIndex(note);
    if (i < 0) return note;
    return (useFlats ? FLATS : SHARPS)[(i + steps + 120) % 12];
  }
  function transposeChord(chord, steps, useFlats) {
    return chord.replace(/^([A-G](?:#|b)?)/, (m) => transposeNote(m, steps, useFlats))
                .replace(/\/([A-G](?:#|b)?)$/, (m, n) => "/" + transposeNote(n, steps, useFlats));
  }
  function transposeLyrics(text, steps, useFlats) {
    return text.replace(/\[([^\]\n]+)\]/g, (m, inner) => CHORD.test(inner.trim()) ? `[${transposeChord(inner.trim(), steps, useFlats)}]` : m);
  }
  const transposeKey = (key, steps, useFlats) => key ? key.replace(/^([A-G](?:#|b)?)/, (m) => transposeNote(m, steps, useFlats)) : key;

  function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const g = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
    return Math.max(1, g ? g.length : 1);
  }

  /* Lyrics text → blocks: { section } or { line: [{ chord, text }], syllables } */
  function parseLyrics(text) {
    return String(text || "").split("\n").map(raw => {
      const line = raw.replace(/\s+$/, "");
      const only = line.trim().match(/^\[([^\]]+)\]$/);
      if (only && !CHORD.test(only[1].trim())) return { section: only[1].trim() };
      if (/^\s*$/.test(line)) return { blank: true };
      const chunks = [];
      let rest = line, chord = "";
      const re = /\[([^\]\n]+)\]/g;
      let last = 0, m;
      while ((m = re.exec(line))) {
        if (!CHORD.test(m[1].trim())) continue;
        chunks.push({ chord, text: line.slice(last, m.index) });
        chord = m[1].trim();
        last = m.index + m[0].length;
      }
      chunks.push({ chord, text: line.slice(last) });
      rest = chunks.map(c => c.text).join("");
      const syl = (rest.match(/[A-Za-z'’]+/g) || []).reduce((n, w) => n + syllables(w), 0);
      return { line: chunks.filter((c, i) => i > 0 || c.text || c.chord), syllables: syl };
    });
  }

  function lyricsView(text, { syllableCounts = true } = {}) {
    return el("div", { class: "mu-lyrics" }, parseLyrics(text).map(b => {
      if (b.section) return el("p", { class: "mu-section" }, b.section);
      if (b.blank) return el("div", { class: "mu-gap" });
      const hasChords = b.line.some(c => c.chord);
      return el("div", { class: `mu-line${hasChords ? " has-chords" : ""}` },
        el("span", { class: "mu-words" }, b.line.map(c => el("span", { class: "mu-chunk" },
          hasChords && el("span", { class: "mu-chord" }, c.chord || " "),
          el("span", { class: "mu-lyric" }, c.text || " ")))),
        syllableCounts && b.syllables > 0 && el("span", { class: "mu-syl", title: "Syllables" }, String(b.syllables)));
    }));
  }


  /* =========================================================
     THE TAB
     ========================================================= */

  function render(panel) {
    const all = songs().map(normalize);
    if (!all.some(s => s.id === currentId)) currentId = all[0]?.id || null;
    const song = all.find(s => s.id === currentId);
    const shown = all.filter(s => (!statusFilter || s.status === statusFilter) && (!search || [s.title, s.lyrics].join(" ").toLowerCase().includes(search.toLowerCase())));

    const searchBox = el("input", { type: "search", class: "tracker-search", placeholder: "Search songs and lyrics", value: search, "aria-label": "Search songs" });
    searchBox.addEventListener("input", () => { search = searchBox.value; render(panel); const b = panel.querySelector(".mu-songs input[type=search]"); b?.focus(); b?.setSelectionRange(search.length, search.length); });
    const filter = el("select", { class: "team-select", "aria-label": "Status" }, el("option", { value: "" }, `All songs (${all.length})`),
      STATUSES.map(s => el("option", { value: s }, `${s} (${all.filter(x => x.status === s).length})`)));
    filter.value = statusFilter;
    filter.addEventListener("change", () => { statusFilter = filter.value; render(panel); });

    M.fill(panel,
      el("div", { class: "mu-layout" },
        el("nav", { class: "mu-songs", "aria-label": "Songs" },
          el("button", { type: "button", class: "small-btn", onclick: () => {
            const s = normalize({ id: newId("song"), title: "Untitled song", status: "Idea", key: "C", time: "4/4", tempo: 90, created: Date.now() });
            all.push(s); saveSongs(all); currentId = s.id; part = "lyrics"; render(panel);
            panel.querySelector(".mu-title")?.select();
          } }, "+ New song"),
          searchBox, filter,
          el("ol", { class: "mu-song-list" }, shown.map(s => el("li", {},
            el("button", { type: "button", class: `mu-song-btn${s.id === currentId ? " is-current" : ""}`, onclick: () => { currentId = s.id; render(panel); } },
              el("span", {}, s.title || "Untitled"),
              el("span", { class: "media-muted" }, [s.status, s.key, s.tempo && `${s.tempo} bpm`].filter(Boolean).join(" · ")))))),
          !all.length && el("p", { class: "media-muted" }, "Your songbook is empty.")),
        song ? songView(song, all, panel) : el("p", { class: "media-empty" }, "Start a song: lyrics and chords, sheet music, who wrote what, and every session and mix.")));
  }

  function songView(s, all, panel) {
    const save = () => saveSoon(all);
    const field = (key, label, attrs = {}) => {
      const input = el("input", { value: s[key] ?? "", "aria-label": label, ...attrs });
      input.addEventListener("input", () => { s[key] = input.value; save(); if (key === "title") panel.querySelector(".mu-song-btn.is-current span").textContent = input.value || "Untitled"; });
      input.addEventListener("change", () => { if (["tempo", "time", "key"].includes(key)) { syncAbc(s); saveSongs(all); } });
      return el("label", { class: "wr-field" }, label, input);
    };
    const pick = (key, label, options) => {
      const select = el("select", { class: "team-select", "aria-label": label }, options.map(o => el("option", { value: o }, o || "—")));
      select.value = s[key] ?? "";
      select.addEventListener("change", () => { s[key] = select.value; if (key !== "status") syncAbc(s); saveSongs(all); render(panel); });
      return el("label", { class: "wr-field" }, label, select);
    };
    const title = el("input", { class: "mu-title", value: s.title, "aria-label": "Song title" });
    title.addEventListener("input", () => { s.title = title.value; save(); });
    title.addEventListener("change", () => { syncAbc(s); saveSongs(all); render(panel); });

    const parts = [["lyrics", "Lyrics and chords"], ["sheet", "Sheet music"], ["splits", `Split sheet${s.splits.length ? ` (${s.splits.length})` : ""}`], ["sessions", "Sessions and versions"]];
    return el("section", { class: "mu-song" },
      el("div", { class: "mu-song-head" }, title,
        el("span", { class: "comment-actions" },
          window.ProjectShare?.claimButton && ProjectShare.claimButton(s.id, s.title),
          exportMenu(s),
          el("button", { type: "button", class: "comment-action", onclick: () => {
            if (!confirm(`Delete “${s.title}” with its lyrics, sheet music, splits and versions?`)) return;
            all.splice(all.indexOf(s), 1); saveSongs(all);
            s.versions.forEach(v => v.file && FileStore.remove(v.file).catch(() => {}));
            render(panel);
          } }, "Delete"))),
      el("div", { class: "mu-facts" },
        pick("status", "Status", STATUSES), pick("key", "Key", KEYS),
        field("tempo", "Tempo (bpm)", { type: "number", min: "20", max: "300" }), pick("time", "Time", TIMES),
        field("length", "Length", { placeholder: "3:30" })),
      el("div", { class: "tool-group view-toggle mu-parts", role: "group", "aria-label": "Part of the song" },
        parts.map(([id, name]) => el("button", { type: "button", "aria-pressed": String(part === id), onclick: () => { part = id; render(panel); } }, name))),
      part === "lyrics" ? lyricsPart(s, all, panel)
        : part === "sheet" ? sheetPart(s, all)
        : part === "splits" ? splitsPart(s, all, panel)
        : sessionsPart(s, all, panel));
  }


  /* =========================================================
     LYRICS AND CHORDS
     ========================================================= */

  function lyricsPart(s, all, panel) {
    const preview = el("div", { class: "mu-preview" }, lyricsView(s.lyrics));
    const box = el("textarea", { class: "mu-lyrics-input", spellcheck: "true", "aria-label": "Lyrics and chords",
      placeholder: "[Verse 1]\n[G]Walking down the [C]road at night\n[Em]Every window [D]burning bright\n\n[Chorus]\n[C]Oh, the [G]rent is due…" });
    box.value = s.lyrics;
    box.addEventListener("input", () => { s.lyrics = box.value; saveSoon(all); preview.replaceChildren(lyricsView(s.lyrics)); });
    const chordsUsed = [...new Set([...s.lyrics.matchAll(/\[([^\]\n]+)\]/g)].map(m => m[1].trim()).filter(c => CHORD.test(c)))];
    // Spell chords the way the new key is usually written (A♭ not G♯; F♯ minor not G♭ minor)
    const flatKey = (key) => {
      const m = String(key || "").match(/^([A-G](?:#|b)?)(m?)/);
      if (!m) return null;
      const i = noteIndex(m[1]);
      return m[2] ? [0, 2, 3, 5, 7, 10].includes(i) : [1, 3, 5, 8, 10].includes(i);
    };
    const transpose = (steps) => {
      const target = transposeKey(s.key, steps, false);
      const flats = flatKey(target) ?? /b/.test(chordsUsed.join(""));
      s.lyrics = transposeLyrics(s.lyrics, steps, flats);
      s.key = transposeKey(s.key, steps, flats);
      syncAbc(s);
      saveSongs(all); render(panel);
      M.setStatus(`Moved ${steps > 0 ? "up" : "down"} a semitone${s.key ? `: now in ${s.key}` : ""}. (Sheet music isn't transposed.)`);
    };
    return el("div", { class: "mu-two" },
      el("div", { class: "mu-col" },
        el("div", { class: "comment-actions" },
          el("button", { type: "button", class: "small-btn", onclick: () => transpose(-1), "aria-label": "Transpose down a semitone" }, "♭ Down"),
          el("button", { type: "button", class: "small-btn", onclick: () => transpose(1), "aria-label": "Transpose up a semitone" }, "♯ Up"),
          el("span", { class: "media-muted" }, chordsUsed.length ? `Chords: ${chordsUsed.join("  ")}` : "Put chords in [square brackets]")),
        box,
        el("p", { class: "media-muted" }, "Chords go in square brackets where they change: [G]Walking down the [C]road. A line with only [Verse 1] or [Chorus] starts a section.")),
      el("div", { class: "mu-col" }, el("h3", { class: "mu-h3" }, "Preview"), preview));
  }


  /* =========================================================
     SHEET MUSIC (ABC notation, drawn by abcjs)
     ========================================================= */

  const abcKey = (key) => key || "C";
  function starterAbc(s) {
    return [`X:1`, `T:${s.title || "Untitled"}`, `M:${s.time || "4/4"}`, `L:1/8`, `Q:1/4=${s.tempo || 90}`, `K:${abcKey(s.key)}`,
      `"${(s.key || "C").replace(/m$/, "m")}"C2 E2 G2 E2 | F2 A2 c2 A2 | G2 B2 d2 B2 | c8 |]`,
      `w: here are the words un-der the notes, one syl-la-ble per note`].join("\n");
  }
  // Keeps the ABC header (title, time, tempo, key) in step with the song's details
  function syncAbc(s) {
    if (!s.abc.trim()) return;
    const set = (field, value) => {
      const re = new RegExp(`^${field}:.*$`, "m");
      s.abc = re.test(s.abc) ? s.abc.replace(re, `${field}:${value}`) : s.abc.replace(/^(X:.*)$/m, `$1\n${field}:${value}`);
    };
    set("T", s.title || "Untitled");
    if (s.time) set("M", s.time);
    if (s.tempo) set("Q", `1/4=${s.tempo}`);
    // K: must stay the last header line
    if (/^K:.*$/m.test(s.abc)) s.abc = s.abc.replace(/^K:.*$/m, `K:${abcKey(s.key)}`);
  }

  /* The key signature: which letters are sharp or flat in a key, e.g. "D" → { F: "♯", C: "♯" }.
     In ABC the K: line applies these by itself, so the note buttons insert plain letters
     but are labelled as they'll sound (F♯ in D major, D♭ in D♭ major). */
  const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
  const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
  const MAJOR_SIGS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
  const MINOR_TO_MAJOR = { A: "C", E: "G", B: "D", "F#": "A", "C#": "E", "G#": "B", "D#": "F#", "A#": "C#", D: "F", G: "Bb", C: "Eb", F: "Ab", Bb: "Db", Eb: "Gb", Ab: "Cb" };
  function keySignature(key) {
    const m = String(key || "C").match(/^([A-G](?:#|b)?)(m?)$/);
    if (!m) return {};
    const major = m[2] ? MINOR_TO_MAJOR[m[1]] : m[1];
    const n = MAJOR_SIGS[major] ?? 0;
    const sig = {};
    if (n > 0) SHARP_ORDER.slice(0, n).forEach(l => { sig[l] = "♯"; });
    if (n < 0) FLAT_ORDER.slice(0, -n).forEach(l => { sig[l] = "♭"; });
    return sig;
  }

  const PALETTE = [
    ["Notes", ["C", "D", "E", "F", "G", "A", "B", "c", "d", "e", "f", "g", "a", "b"], "notes follow the key signature (use = for a natural, ^ or _ for other sharps and flats). Lower case is the octave above; add , (lower) or ' (higher)"],
    ["Length", [["2", "×2 (longer)"], ["4", "×4"], ["8", "whole bar (4/4)"], ["/2", "half (shorter)"], ["3/2", "dotted"]], "After a note: C2 is twice as long as C"],
    ["Rests", [["z", "rest"], ["z2", "longer rest"], ["z8", "bar rest"]], ""],
    ["Marks", [["^", "sharp ♯ (before note)"], ["_", "flat ♭ (before note)"], ["=", "natural ♮"], ["-", "tie to next"], ["(3", "triplet"], ["[CEG]", "chord (notes together)"], ["\"G\"", "chord symbol above"]], ""],
    ["Bars", [[" | ", "bar line"], [" || ", "double bar"], [" |] ", "final bar"], [" |: ", "start repeat"], [" :| ", "end repeat"], ["\n", "new line of music"]], ""],
    ["Words", [["\nw: ", "lyrics under the line above (hyphens split syllables)"], ["\nP:A\n", "part / section label"]], ""],
  ];

  /* ---------- Placing notes by clicking on the staff ----------
     Four tools sit above the score:
       Note / Rest  a click on the staff puts one there, at the pitch under the
                    pointer, after the nearest note to the left (a click on or
                    right next to a note selects it instead)
       Select       a click on or near a note selects it
       Erase        a click on or near a note deletes it
     The selected note can be moved a step or an octave, given a new length or
     accidental, or deleted; the arrow keys, Delete and Enter do the same while
     the score has focus. New line adds an empty line of music (an invisible
     whole-bar rest, x8, that the first note placed on it replaces).
     Everything still goes through the ABC text, so the text box stays the
     source of truth and undo works as usual. */
  const LENGTHS = [["1", "whole"], ["1/2", "half"], ["1/4", "quarter"], ["1/8", "eighth"], ["1/16", "sixteenth"]];
  const place = { tool: "note", length: "1/4", dotted: false, accidental: "" };   // shared by every song's editor (what you picked last)

  /* Icons for the tool buttons, drawn here: the music symbols in Unicode
     (𝅝 𝅗𝅥 𝄽…) are missing from most fonts and showed as empty boxes */
  const head = (filled) => `<ellipse cx="7.5" cy="18.5" rx="4.3" ry="3.1" transform="rotate(-20 7.5 18.5)" ${filled ? "" : `fill="none" stroke="currentColor" stroke-width="1.6"`}/>`;
  const STEM = `<path d="M11.2 18V3.5" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
  const flag = (y) => `<path d="M11.2 ${y}c0.5 3.5 5 4.5 3.6 9.5" fill="none" stroke="currentColor" stroke-width="1.7"/>`;
  const ICONS = {
    "note-1": head(false).replace(/7\.5/g, "9"),
    "note-1/2": head(false) + STEM,
    "note-1/4": head(true) + STEM,
    "note-1/8": head(true) + STEM + flag(3.5),
    "note-1/16": head(true) + STEM + flag(3.5) + flag(8),
    "rest-1": `<path d="M2 9h14" stroke="currentColor" stroke-width="1.2"/><rect x="5" y="9" width="8" height="4.5"/>`,
    "rest-1/2": `<path d="M2 15h14" stroke="currentColor" stroke-width="1.2"/><rect x="5" y="10.5" width="8" height="4.5"/>`,
    "rest-1/4": `<path d="M7 2.5l4.2 5.2-3.4 4.1 4.4 5.2c-3.2-1.3-5.6 0.3-3 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    "rest-1/8": `<circle cx="6.5" cy="8.5" r="2.1"/><path d="M6 10.3c2.4 1.2 5 0.4 6.6-2L8.4 21" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
    "rest-1/16": `<circle cx="7.5" cy="5.5" r="2"/><circle cx="5.5" cy="11.5" r="2"/><path d="M7 7.2c2.4 1.2 5 0.4 6.6-2M5 13.2c2.4 1.2 5 0.4 6.6-2M13.6 5.2L9 22" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
    select: `<path d="M5 3v15.5l3.8-3.6 2.9 6.4 2.6-1.2-2.9-6.3h5.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
    erase: `<path d="M2.5 15.5l8.5-9.5 6 5.3-7.6 8.7H6.2z M6.5 11l6 5.3 M7 20h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  };
  function icon(name) {
    const span = el("span", { class: "mu-icon", "aria-hidden": "true" });
    span.innerHTML = `<svg viewBox="0 0 18 24" width="15" height="20" fill="currentColor">${ICONS[name]}</svg>`;
    return span;
  }

  // The unit note length from the ABC header (L:1/8 unless the user changed it)
  const unitLength = (abc) => { const m = /^L:\s*(\d+)\/(\d+)/m.exec(abc); return m ? Number(m[1]) / Number(m[2]) : 1 / 8; };
  const frac = (text) => { const [n, d = 1] = text.split("/").map(Number); return n / d; };
  // A length as ABC writes it after the note, relative to the unit: 1/4 with L:1/8 → "2"; 1/16 → "/2"; dotted 1/4 → "3"
  function lengthSuffix(length, dotted, abc) {
    const ratio = frac(length) * (dotted ? 1.5 : 1) / unitLength(abc);
    if (Number.isInteger(ratio)) return ratio === 1 ? "" : String(ratio);
    for (const d of [2, 4, 8, 16, 32]) { const n = ratio * d; if (Number.isInteger(n)) return n === 1 ? `/${d}` : `${n}/${d}`; }
    return "";
  }
  // A whole bar's length, from the M: line (C is 4/4, C| is 2/2)
  function barSuffix(abc) {
    const m = /^M:\s*(\S+)/m.exec(abc);
    const meter = !m ? "4/4" : m[1] === "C" ? "4/4" : m[1] === "C|" ? "2/2" : m[1];
    return /^\d+\/\d+$/.test(meter) ? lengthSuffix(meter, false, abc) : "8";
  }
  // A pitch number (abcjs: 0 = middle C, one per staff step) as an ABC note name
  function pitchName(p) {
    const letter = "CDEFGAB"[((p % 7) + 7) % 7];
    const octave = Math.floor(p / 7);
    return octave >= 1 ? letter.toLowerCase() + "'".repeat(octave - 1) : letter + ",".repeat(-octave);
  }
  const NOTE_RE = /^([_^=]*)([A-Ga-g])([,']*)(\d*\/?\d*)(-?)$/;
  const FILLER_RE = /^x[\d/]*$/;   // an invisible rest holding an empty line open

  // Where the music ends: the end of the last line of notes (not a header, comment or w: lyrics line)
  function musicEnd(abc) {
    let pos = 0, found = -1;
    for (const line of abc.split("\n")) {
      if (line.trim() && !/^[A-Za-z]:/.test(line) && !/^%/.test(line)) found = pos + line.length;
      pos += line.length + 1;
    }
    return found >= 0 ? found : abc.length;
  }

  // How long a stretch of ABC is, in unit lengths (notes, rests and [chords]; chord symbols and !marks! skipped)
  function unitsIn(text) {
    let sum = 0;
    const clean = text.replace(/"[^"]*"/g, "").replace(/![^!]*!/g, "");
    for (const m of clean.matchAll(/(?:\[[^\]|:]*\]|[_^=]*[A-Ga-gzx][,']*)(\d*)(\/*)(\d*)/g)) {
      const n = m[1] ? Number(m[1]) : 1;
      const d = m[3] ? Number(m[3]) : m[2] ? 2 ** m[2].length : 1;
      sum += n / d;
    }
    return sum;
  }
  const barUnits = (abc) => frac(barSuffix(abc) || "1");

  /* A MIDI note number (60 = middle C) as an ABC note, spelled for the key:
     a note of the key is a plain letter (the K: line sharpens or flattens it),
     a letter the key alters gets = for a natural, and anything else a sharp,
     or a flat in flat keys. */
  const NAT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midiToAbc(midi, key) {
    const sig = keySignature(key);
    const shift = (l) => sig[l] === "♯" ? 1 : sig[l] === "♭" ? -1 : 0;
    const pc = ((midi % 12) + 12) % 12;
    const letters = [..."CDEFGAB"];
    let acc = "", sounding;
    let letter = letters.find(l => (NAT_PC[l] + shift(l) + 12) % 12 === pc);
    if (letter) sounding = shift(letter);
    else if ((letter = letters.find(l => NAT_PC[l] === pc && shift(l)))) { acc = "="; sounding = 0; }
    else {
      sounding = Object.values(sig).includes("♭") ? -1 : 1;
      letter = letters.find(l => (NAT_PC[l] + sounding + 12) % 12 === pc);
      acc = sounding > 0 ? "^" : "_";
    }
    const octave = Math.round((midi - sounding - NAT_PC[letter] - 60) / 12);
    return acc + pitchName(letters.indexOf(letter) + octave * 7);
  }

  /* ---------- A MIDI keyboard (Web MIDI: Chrome, Edge, Firefox; not Safari) ----------
     Connected once for the page; whichever sheet music editor is open
     receives the notes. Keys pressed together (within 50 ms) arrive as a
     chord. Each key sounds through a small synth built on Web Audio, so
     it plays at once and needs no internet. */
  const midi = {
    supported: typeof navigator !== "undefined" && !!navigator.requestMIDIAccess,
    access: null, error: "", sound: true,
    target: null,                 // { enter(notes), refresh(), alive() } from the open editor
    pending: [], timer: 0,
    audio: null, voices: new Map(),
    inputs() { return this.access ? [...this.access.inputs.values()].filter(i => i.state !== "disconnected") : []; },
    async connect() {
      // The click that connects also unlocks sound (browsers only start audio after a click)
      try { this.audio ??= new (window.AudioContext || window.webkitAudioContext)(); this.audio.resume?.(); } catch { /* no sound, notes still arrive */ }
      try {
        this.access = await navigator.requestMIDIAccess();
        this.error = "";
        this.listen();
        this.access.onstatechange = () => { this.listen(); this.refresh(); };
      } catch {
        this.error = "The browser didn't allow MIDI. Allow it in the address bar's site settings, then try again.";
      }
      this.refresh();
    },
    listen() { this.inputs().forEach(input => { input.onmidimessage = (e) => this.message(e.data); }); },
    refresh() { if (this.target?.alive()) this.target.refresh(); },
    message([status, note, velocity]) {
      const type = status & 0xf0;
      if (type === 0x90 && velocity > 0) {
        this.noteOn(note, velocity);
        this.pending.push(note);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const notes = [...new Set(this.pending)];
          this.pending = [];
          if (this.target?.alive()) this.target.enter(notes);
        }, 50);
      } else if (type === 0x80 || type === 0x90) this.noteOff(note);
    },
    noteOn(note, velocity = 100) {
      if (!this.sound || !this.audio) return;
      this.noteOff(note);
      const ctx = this.audio, t = ctx.currentTime;
      const freq = 440 * 2 ** ((note - 69) / 12);
      const gain = ctx.createGain();
      const peak = 0.05 + 0.2 * (velocity / 127);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.8);   // a plucked, piano-ish fade while held
      gain.connect(ctx.destination);
      const oscs = [["triangle", 1, 1], ["sine", 2, 0.3]].map(([type, mult, level]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = type; o.frequency.value = freq * mult; g.gain.value = level;
        o.connect(g).connect(gain); o.start(t);
        return o;
      });
      this.voices.set(note, { gain, oscs });
    },
    noteOff(note) {
      const v = this.voices.get(note);
      if (!v) return;
      const t = this.audio.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), t);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      v.oscs.forEach(o => o.stop(t + 0.35));
      this.voices.delete(note);
    },
  };

  function sheetPart(s, all) {
    const out = el("div", { class: "mu-score", "aria-label": "Sheet music. With a note selected: arrow keys move it, Shift+arrow by an octave, Delete removes it, Enter starts a new line after it", tabindex: "0" });
    const warnings = el("p", { class: "media-muted mu-warnings" });
    const box = el("textarea", { class: "mu-abc", spellcheck: "false", "aria-label": "ABC notation" });
    if (!s.abc.trim()) s.abc = starterAbc(s);
    box.value = s.abc;
    let timer = 0;
    let tune = null;
    let selected = null;   // { startChar, endChar } of the selected note or rest, in s.abc
    const hint = el("p", { class: "media-muted mu-place-hint", role: "status" });

    const draw = () => {
      if (!window.ABCJS) { out.replaceChildren(el("p", { class: "media-empty" }, "The sheet music drawer didn't load.")); return null; }
      [tune] = ABCJS.renderAbc(out, s.abc, { responsive: "resize", add_classes: true, foregroundColor: "currentColor" });
      warnings.textContent = tune?.warnings?.length ? `Check: ${tune.warnings.map(w => String(w).replace(/<[^>]+>/g, "")).slice(0, 3).join(" · ")}` : "";
      if (selected) highlightSelected();
      return tune;
    };
    box.addEventListener("input", () => {
      s.abc = box.value; saveSoon(all);
      if (selected) { selected = null; drawTools(); updateHint(); }   // typing moves the text under the selection
      clearTimeout(timer); timer = setTimeout(draw, 250);
    });
    const insert = (text) => {
      const a = box.selectionStart, b = box.selectionEnd;
      box.setRangeText(text, a, b, "end");
      box.focus();
      box.dispatchEvent(new Event("input"));
    };
    // Change the ABC text from the staff tools (saved and redrawn at once)
    const splice = (from, to, text, { selectInserted = false } = {}) => {
      s.abc = s.abc.slice(0, from) + text + s.abc.slice(to);
      box.value = s.abc;
      const lead = text.length - text.trimStart().length;
      selected = selectInserted ? { startChar: from + lead, endChar: from + text.trimEnd().length } : null;
      saveSoon(all);
      clearTimeout(timer);
      draw();
    };

    /* The notes and rests on the score, in order, with the line each is on */
    function elements() {
      const list = [];
      (tune?.lines || []).forEach((line, n) => (line.staff || []).forEach(staff => (staff.voices || []).forEach(voice => voice.forEach(e => {
        if (e.el_type === "note" && e.startChar != null && e.abselem?.elemset?.length && !["invisible", "spacer"].includes(e.rest?.type)) list.push({ e, line: n });
      }))));
      return list;
    }
    // The note's drawn shape on screen (note heads, stems, flags, rests: not the lyrics under it), or just its heads
    function shapeOf(e, headsOnly) {
      let r = null;
      for (const g of e.abselem.elemset) for (const p of g.querySelectorAll?.(headsOnly && !g.classList?.contains("abcjs-rest") ? "path.abcjs-notehead" : "path") || []) {
        const b = p.getBoundingClientRect();
        if (!b.width && !b.height) continue;
        r = r ? { left: Math.min(r.left, b.left), right: Math.max(r.right, b.right), top: Math.min(r.top, b.top), bottom: Math.max(r.bottom, b.bottom) }
              : { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      }
      return r;
    }
    // The note nearest a click, if it's within reach (in screen pixels)
    function noteNear(event, reachX, reachY, headsOnly = false) {
      let best = null;
      for (const item of elements()) {
        const r = shapeOf(item.e, headsOnly);
        if (!r) continue;
        const dx = Math.max(r.left - event.clientX, 0, event.clientX - r.right);
        const dy = Math.max(r.top - event.clientY, 0, event.clientY - r.bottom);
        if (dx > reachX || dy > reachY) continue;
        const d = Math.hypot(dx, dy);
        if (!best || d < best.d) best = { e: item.e, d };
      }
      return best?.e || null;
    }

    /* The selected note: its text, and what can be done to it */
    const selectedText = () => selected ? s.abc.slice(selected.startChar, selected.endChar) : "";
    const selectedIsNote = () => NOTE_RE.test(selectedText().trim());
    function setSelected(e) {
      selected = e ? { startChar: e.startChar, endChar: e.endChar } : null;
      highlightSelected();
      drawTools();
      updateHint();
    }
    function highlightSelected() {
      out.querySelectorAll(".mu-selected").forEach(n => n.classList.remove("mu-selected"));
      if (!selected || !tune) return;
      for (const { e } of elements()) if (e.startChar === selected.startChar) e.abselem.elemset.forEach(n => n.classList?.add("mu-selected"));
    }
    function updateHint() {
      const text = selectedText().trim();
      hint.textContent = text
        ? `Selected: ${text}. ↑ ↓ move it a step, Octave ↑ ↓ an octave, a length or ♯ ♭ ♮ button changes it, Delete removes it. ← → pick the note before or after.`
        : place.tool === "select" ? "Click a note or rest to select it."
        : place.tool === "erase" ? "Click a note or rest to delete it."
        : place.tool === "note" ? "Click on the staff to put a note there (after the note to the left of the click). Click a note to select it."
        : "Click on the staff to put a rest there. Click a note to select it.";
    }
    // After a change, select the note or rest that now starts at (or after) a place in the text
    function selectFrom(startChar) {
      const list = elements();
      const next = list.find(x => x.e.startChar >= startChar) || list[list.length - 1];
      setSelected(next?.e || null);
    }
    function deleteSelected() {
      if (!selected) return;
      let { startChar, endChar } = selected;
      if (s.abc[endChar] === " ") endChar++;   // and the space after it
      splice(startChar, endChar, "");
      if (place.tool === "erase") setSelected(null);
      else selectFrom(startChar);   // so Delete can be pressed again to keep going
    }
    // Swap the selected note's text for another, keeping the spaces around it (abcjs counts the space after a note as part of it)
    function replaceSelected(token) {
      const text = selectedText();
      splice(selected.startChar, selected.endChar, /^\s*/.exec(text)[0] + token + /\s*$/.exec(text)[0], { selectInserted: true });
    }
    function moveSelected(steps) {
      const m = NOTE_RE.exec(selectedText().trim());
      if (!m) return;
      const [, acc, letter, marks, len, tie] = m;
      const octave = (letter === letter.toLowerCase() ? 1 : 0) + (marks.match(/'/g) || []).length - (marks.match(/,/g) || []).length;
      const p = "CDEFGAB".indexOf(letter.toUpperCase()) + octave * 7 + steps;
      replaceSelected(acc + pitchName(p) + len + tie);
      drawTools(); updateHint();
    }
    function relengthSelected() {
      const text = selectedText().trim();
      const m = NOTE_RE.exec(text) || /^(z)()()(\d*\/?\d*)()$/.exec(text);
      if (!m) return;
      const [, acc, letter, marks, , tie] = m;
      replaceSelected(acc + letter + marks + lengthSuffix(place.length, place.dotted, s.abc) + tie);
      updateHint();
    }
    function accidentalSelected(acc) {
      const m = NOTE_RE.exec(selectedText().trim());
      if (!m) return;
      const [, , letter, marks, len, tie] = m;
      replaceSelected(acc + letter + marks + len + tie);
      updateHint();
    }
    function stepSelection(dir) {
      const list = elements();
      if (!list.length) return;
      const i = selected ? list.findIndex(x => x.e.startChar === selected.startChar) : -1;
      const next = list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : Math.min(list.length - 1, Math.max(0, i + dir))];
      setSelected(next.e);
    }

    /* Bar lines and new lines: after the selected note, or at the end of the music */
    function addBar() {
      if (selected) {
        const at = selected.endChar;
        const before = /\s$/.test(selectedText()) ? "" : " ";
        splice(at, at, `${before}| `);
        setSelected(null);
        return;
      }
      const end = musicEnd(s.abc);
      if (/\|\s*$/.test(s.abc.slice(0, end))) { M.setStatus("The music already ends with a bar line."); return; }
      splice(end, end, " |");
    }
    function newLine() {
      if (selected) {
        // Break the line after the selected note, keeping a bar line that follows it on this line
        const rest = s.abc.slice(selected.endChar);
        const keep = /^[ \t]*(?:\|\]|\|\||:\||\|(?!:))?/.exec(rest)[0];
        const spaces = /^[ \t]*/.exec(rest.slice(keep.length))[0];
        const at = selected.endChar + keep.length;
        splice(at, at + spaces.length, "\n");
        setSelected(null);
        M.setStatus("The music after that note starts a new line. (A w: lyrics line stays with the line above it.)");
        return;
      }
      // An empty line at the end: an invisible whole-bar rest keeps the staff there to click on.
      // A final bar |] moves from the old last line to the new one.
      let abc = s.abc.replace(/\s+$/, "");
      const end = musicEnd(abc);
      const finalBar = /\|\]\s*$/.test(abc.slice(0, end));
      if (finalBar) abc = abc.slice(0, end).replace(/\|\]\s*$/, "|") + abc.slice(end);
      splice(0, s.abc.length, `${abc}\nx${barSuffix(abc)} ${finalBar ? "|]" : "|"}`);
      setSelected(null);
      if (place.tool !== "note" && place.tool !== "rest") { place.tool = "note"; drawTools(); updateHint(); }
      M.setStatus("Added a new line of music: click on it to put notes there.");
    }

    /* A click on the staff: which line, which pitch, after which note */
    function placeAt(event) {
      if (!out.querySelector("svg")) return;
      // The nearest staff (each music line is a <g class="abcjs-staff abcjs-l<n>">), measured on screen
      let best = null;
      out.querySelectorAll("g.abcjs-staff").forEach(g => {
        const n = Number((g.getAttribute("class").match(/abcjs-l(\d+)/) || [])[1]);
        const r = g.getBoundingClientRect();
        const step = r.height / 8;   // five lines, four gaps, two steps per gap
        const dist = event.clientY < r.top ? r.top - event.clientY : event.clientY > r.bottom ? event.clientY - r.bottom : 0;
        if (dist > step * 14) return;   // too far above or below any staff
        if (!best || dist < best.dist) best = { n, g, rect: r, step, dist };
      });
      if (!best || !Number.isFinite(best.n)) return;
      const pitch = Math.round((best.rect.top - event.clientY) / best.step) + 10;   // the top line is F (pitch 10 above middle C)
      // The click's x in the drawing's own units (the staff's box is known in both)
      const bbox = best.g.getBBox();
      const x = bbox.x + (event.clientX - best.rect.left) * (bbox.width / best.rect.width);
      // Where in the text: after the last note, rest or bar to the left of the click on that line
      const voice = tune.lines[best.n]?.staff?.[0]?.voices?.[0] || [];
      const placed = voice.filter(e => e.startChar != null && e.abselem && typeof e.abselem.x === "number");
      let at = null;
      for (const e of placed) if (e.abselem.x <= x) at = e;
      const token = place.tool === "rest"
        ? "z" + lengthSuffix(place.length, place.dotted, s.abc)
        : place.accidental + pitchName(pitch) + lengthSuffix(place.length, place.dotted, s.abc);
      // An empty line (from New line): the first note replaces its invisible rest
      const filler = placed.find(e => FILLER_RE.test(s.abc.slice(e.startChar, e.endChar).trim()));
      if (filler && (!at || at === filler)) {
        const text = s.abc.slice(filler.startChar, filler.endChar);
        splice(filler.startChar, filler.endChar, token + (/\s*$/.exec(text)[0] || " "), { selectInserted: true });
      }
      else if (at) {
        const after = s.abc.slice(at.startChar, at.endChar);
        const before = s.abc[at.endChar] || "";
        // Keep one space on each side of the new note, whatever the text around it has
        const text = (/\s$/.test(after) ? "" : " ") + token + (/^[\s|\]]/.test(before) ? (/\s/.test(before) ? "" : " ") : " ");
        splice(at.endChar, at.endChar, text, { selectInserted: true });
      }
      else if (placed[0]) splice(placed[0].startChar, placed[0].startChar, token + " ", { selectInserted: true });
      else {
        // An empty tune: after the K: line
        const k = s.abc.search(/^K:.*$/m);
        const end = k >= 0 ? s.abc.indexOf("\n", k) : s.abc.length;
        splice(end < 0 ? s.abc.length : end, end < 0 ? s.abc.length : end, "\n" + token, { selectInserted: true });
      }
      drawTools(); updateHint();
    }

    out.addEventListener("click", (event) => {
      if (!tune) return;
      out.focus({ preventScroll: true });
      if (place.tool === "select" || place.tool === "erase") {
        // Generous reach: these tools never place anything, so a near miss still finds the note
        const e = noteNear(event, 24, 40);
        if (!e) { setSelected(null); return; }
        setSelected(e);
        if (place.tool === "erase") deleteSelected();
        return;
      }
      if (event.target.closest(".abcjs-lyric, .abcjs-chord")) return;
      // On or right next to a note head: select it rather than place another on top of it
      const near = noteNear(event, 4, 4, true);
      if (near) { setSelected(near); return; }
      placeAt(event);
    });
    out.addEventListener("keydown", (event) => {
      if (event.target !== out) return;
      const k = event.key;
      const handled =
        (k === "Delete" || k === "Backspace") && selected ? (deleteSelected(), true)
        : (k === "ArrowUp" || k === "ArrowDown") && selected ? (moveSelected((k === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 7 : 1)), true)
        : k === "ArrowLeft" || k === "ArrowRight" ? (stepSelection(k === "ArrowRight" ? 1 : -1), true)
        : k === "Enter" ? (newLine(), true)
        : k === "Escape" && selected ? (setSelected(null), true)
        : false;
      if (handled) event.preventDefault();
    });

    /* The tool bar above the score */
    const toolButton = (content, pressed, onclick, title, extra = "") => el("button", { type: "button", class: `mu-tool${extra}`, "aria-pressed": String(pressed), title, "aria-label": title, onclick }, content);
    const action = (label, onclick, title, disabled = false) => el("button", { type: "button", class: "mu-tool mu-tool-text", title, "aria-label": title, disabled, onclick }, label);
    const pickTool = (tool) => { place.tool = tool; if (tool !== "select") { selected = null; highlightSelected(); } drawTools(); updateHint(); out.classList.toggle("is-placing", tool === "note" || tool === "rest"); out.classList.toggle("is-picking", tool === "select" || tool === "erase"); };
    const tools = el("div", { class: "mu-place", role: "toolbar", "aria-label": "Place notes" });
    function drawTools() {
      const sel = !!selected, note = sel && selectedIsNote();
      const restIcons = place.tool === "rest";
      tools.replaceChildren(
        el("div", { class: "mu-place-row" },
          el("span", { class: "mu-place-group" }, el("span", { class: "mu-place-label" }, "Tool"),
            toolButton([icon("note-1/4"), "Note"], place.tool === "note", () => pickTool("note"), "Place notes", " mu-tool-text"),
            toolButton([icon("rest-1/4"), "Rest"], place.tool === "rest", () => pickTool("rest"), "Place rests", " mu-tool-text"),
            toolButton([icon("select"), "Select"], place.tool === "select", () => pickTool("select"), "Select notes (click a note)", " mu-tool-text"),
            toolButton([icon("erase"), "Erase"], place.tool === "erase", () => pickTool("erase"), "Erase notes (click a note to delete it)", " mu-tool-text")),
          el("span", { class: "mu-place-group" }, el("span", { class: "mu-place-label" }, "Length"),
            LENGTHS.map(([len, name]) => toolButton(icon(`${restIcons ? "rest" : "note"}-${len}`), place.length === len, () => { place.length = len; drawTools(); if (selected) relengthSelected(); }, `${name[0].toUpperCase()}${name.slice(1)} ${restIcons ? "rest" : "note"} (${len})`)),
            toolButton(el("span", { class: "mu-dot", "aria-hidden": "true" }), place.dotted, () => { place.dotted = !place.dotted; drawTools(); if (selected) relengthSelected(); }, "Dotted (half as long again)")),
          el("span", { class: "mu-place-group" }, el("span", { class: "mu-place-label" }, "Accidental"),
            [["", "Key", "As the key signature says"], ["^", "♯", "Sharp"], ["_", "♭", "Flat"], ["=", "♮", "Natural (cancels the key signature)"]].map(([v, label, title]) =>
              toolButton(label, place.accidental === v, () => { place.accidental = v; drawTools(); if (note) accidentalSelected(v); }, title, v ? "" : " mu-tool-text")))),
        el("div", { class: "mu-place-row" },
          el("span", { class: "mu-place-group" }, el("span", { class: "mu-place-label" }, "Selected"),
            action("←", () => stepSelection(-1), "Select the note before"),
            action("→", () => stepSelection(1), "Select the note after"),
            action("↑ Step", () => moveSelected(1), "Move the selected note up", !note),
            action("↓ Step", () => moveSelected(-1), "Move the selected note down", !note),
            action("Octave ↑", () => moveSelected(7), "Move the selected note up an octave", !note),
            action("Octave ↓", () => moveSelected(-7), "Move the selected note down an octave", !note),
            action("Delete", deleteSelected, "Delete the selected note", !sel),
            action("Deselect", () => setSelected(null), "Deselect", !sel)),
          el("span", { class: "mu-place-group" }, el("span", { class: "mu-place-label" }, "Add"),
            action("| Bar line", addBar, sel ? "Add a bar line after the selected note" : "Add a bar line at the end of the music"),
            action("↵ New line", newLine, sel ? "Start a new line after the selected note" : "Add an empty line of music at the end")),
          midiControls()));
    }

    /* ---------- Notes from a MIDI keyboard ----------
       Each key (or chord) goes in at the length picked above, after the
       selected note or at the end of the music, and becomes the selection,
       so the next one follows it. A bar line goes in when a bar fills up,
       and a new line after every four bars. */
    function midiControls() {
      const group = el("span", { class: "mu-place-group mu-midi" }, el("span", { class: "mu-place-label" }, "MIDI"));
      if (!midi.supported) {
        group.append(el("span", { class: "media-muted" }, "This browser can't use MIDI keyboards: try Chrome, Edge or Firefox."));
        return group;
      }
      if (!midi.access) {
        group.append(action("Connect MIDI keyboard", () => midi.connect(), "Play notes in from a MIDI keyboard or controller"));
        if (midi.error) group.append(el("span", { class: "media-muted" }, midi.error));
        return group;
      }
      const names = midi.inputs().map(i => i.name || "MIDI keyboard");
      group.append(
        el("span", { class: `mu-midi-status${names.length ? " is-on" : ""}` }, names.length ? `● ${names.join(", ")}` : "No keyboard found: plug one in"),
        toolButton("Sound", midi.sound, () => { midi.sound = !midi.sound; drawTools(); }, "Play each note as it goes in", " mu-tool-text"));
      return group;
    }
    function enterNotes(notes) {
      // Spelled for the key the music is in (its K: line, normally the song's key)
      const k = /^K:\s*([A-G][#b]?)(m(?:in)?\b)?/m.exec(s.abc);
      const key = k ? k[1] + (k[2] ? "m" : "") : s.key;
      const names = [...notes].sort((a, b) => a - b).map(n => midiToAbc(n, key));
      const len = lengthSuffix(place.length, place.dotted, s.abc);
      const token = names.length > 1 ? `[${names.join("")}]${len}` : names[0] + len;
      // Where: after the selection, or the end of the music (an empty New line's placeholder is replaced)
      let at;
      if (selected) at = selected.startChar + selectedText().trimEnd().length;
      else {
        const filler = [...s.abc.matchAll(/(^|[ \t])(x[\d/]*)(?=[ \t|]|$)/gm)].filter(m => m.index >= s.abc.search(/^K:/m) && !/^[A-Za-z]:/.test(s.abc.slice(s.abc.lastIndexOf("\n", m.index) + 1))).pop();
        if (filler) {
          const from = filler.index + filler[1].length;
          splice(from, from + filler[2].length, token, { selectInserted: true });
          afterEntry();
          return;
        }
        at = musicEnd(s.abc);
        // Notes added after a final bar |] carry on the music: it becomes a plain bar line
        const fin = /\|\]\s*$/.exec(s.abc.slice(0, at));
        if (fin) { s.abc = s.abc.slice(0, fin.index) + "|" + s.abc.slice(fin.index + 2); at -= 1; }
      }
      // A full bar before this point: go past its bar line (or add one)
      let prefix = "";
      const lineStart = s.abc.lastIndexOf("\n", at - 1) + 1;
      const bar = s.abc.slice(lineStart, at);
      const sinceBar = bar.slice(bar.lastIndexOf("|") + 1);
      if (unitsIn(sinceBar) >= barUnits(s.abc) - 1e-9) {
        const next = /^[ \t]*(?:\|\]|\|\||:\||\|)/.exec(s.abc.slice(at));
        if (next) {
          at += next[0].length;
          // At the end of a line, carry on at the start of the next line of music (not a w: line)
          const rest = s.abc.slice(at);
          const nl = /^[ \t]*\n/.exec(rest);
          if (nl && !/^[A-Za-z]:|^%/.test(rest.slice(nl[0].length))) at += nl[0].length;
        } else prefix = "| ";
      }
      const before = s.abc[at - 1], after = s.abc[at];
      const text = (at === 0 || /\s/.test(before) ? "" : " ") + prefix + token + (after == null || /\s/.test(after) ? "" : " ");
      splice(at, at, text, { selectInserted: true });
      afterEntry();
    }
    function afterEntry() {
      // The bar is full now: add its bar line, and start a new line after every fourth bar
      const end = selected.endChar;
      const lineStart = s.abc.lastIndexOf("\n", end - 1) + 1;
      const bar = s.abc.slice(lineStart, end);
      const full = unitsIn(bar.slice(bar.lastIndexOf("|") + 1)) >= barUnits(s.abc) - 1e-9;
      if (full && !/^[ \t]*\|/.test(s.abc.slice(end))) {
        const keep = { ...selected };
        const bars = (bar.match(/\|+\]?|:\|/g) || []).length + 1;
        // Only at the very end: a line break before an existing one would leave a blank line, which ends the tune in ABC
        const atEnd = !s.abc.slice(end).trim();
        splice(end, end, bars >= 4 && atEnd ? " |\n" : " |");
        selected = keep;
        highlightSelected();
      }
      drawTools();
      updateHint();
    }
    midi.target = { enter: enterNotes, refresh: drawTools, alive: () => out.isConnected };

    pickTool(place.tool);

    let synth = null;
    const play = async (button) => {
      if (synth) { synth.stop(); synth = null; button.textContent = "▶ Play"; return; }
      if (!ABCJS.synth?.supportsAudio?.()) { M.setStatus("This browser can't play the music."); return; }
      const tune = draw();
      try {
        button.textContent = "Loading sounds…";
        synth = new ABCJS.synth.CreateSynth();
        await synth.init({ visualObj: tune, options: { onEnded: () => { synth = null; button.textContent = "▶ Play"; } } });
        await synth.prime();
        synth.start();
        button.textContent = "■ Stop";
      } catch {
        synth = null;
        button.textContent = "▶ Play";
        M.setStatus("Couldn't play it: the instrument sounds load from the internet. Check your connection.");
      }
    };

    setTimeout(draw, 0);
    return el("div", { class: "mu-sheet" },
      tools,
      hint,
      el("details", { class: "mu-palette-details" }, el("summary", {}, "Type ABC instead: notes, lengths, marks and words"),
      el("div", { class: "mu-palette" }, PALETTE.map(([group, items, tip]) => el("div", { class: "mu-palette-group" },
        el("span", { class: "mu-palette-label", title: group === "Notes" ? `In ${s.key || "C"}: ${tip}` : tip }, group),
        items.map(item => {
          if (!Array.isArray(item)) {
            // A note: labelled with the key's sharp or flat; the tonic is marked
            const sig = keySignature(s.key)[item.toUpperCase()] || "";
            const name = item + sig;
            const tonic = (s.key || "C").match(/^[A-G]/)[0] === item.toUpperCase() && (s.key || "C").replace(/m$/, "").slice(1) === (sig === "♯" ? "#" : sig === "♭" ? "b" : "");
            const label = `${item.toUpperCase()}${sig}${item === item.toLowerCase() ? " (higher octave)" : ""}${sig ? `, from the key of ${s.key}` : ""}`;
            return el("button", { type: "button", class: `mu-key${sig ? " is-altered" : ""}${tonic ? " is-tonic" : ""}`, title: label, "aria-label": `Insert ${label}`, onclick: () => insert(item) }, name);
          }
          const [text, label] = item;
          return el("button", { type: "button", class: "mu-key", title: label, "aria-label": `Insert ${label}`, onclick: () => insert(text) }, text.trim() || "↵");
        }))))),
      el("div", { class: "mu-two" },
        el("div", { class: "mu-col" }, out,
          el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "small-btn", onclick: (e) => play(e.currentTarget) }, "▶ Play"),
            el("button", { type: "button", class: "small-btn", title: "Opens the print window: choose “Save as PDF”", onclick: () => songPDF(s, { sheet: true, lyrics: false }) }, "Export PDF"),
            el("button", { type: "button", class: "small-btn", title: "Downloads a MIDI file for GarageBand, Logic, MuseScore…", onclick: () => exportMidi(s) }, "Export MIDI"),
            el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm("Start the sheet music again from the template?")) { s.abc = starterAbc(s); box.value = s.abc; selected = null; saveSongs(all); draw(); drawTools(); updateHint(); } } }, "Start again"),
            el("a", { class: "comment-action", href: "https://abcnotation.com/learn", target: "_blank", rel: "noopener" }, "How ABC notation works")),
          warnings),
        el("div", { class: "mu-col" }, box)),
      el("p", { class: "media-muted" }, "Pick a note or rest and a length, then click on the staff where it goes; Select or Erase picks out notes to change or remove, and New line adds a line of music. The text underneath is the same music in ABC notation (letters are notes, numbers make them longer, | is a bar line, a w: line puts lyrics under the notes) and you can type there too. Title, time, tempo and key follow the song's details above."));
  }


  /* =========================================================
     SPLIT SHEET
     ========================================================= */

  function splitsPart(s, all, panel) {
    const save = () => saveSongs(all);
    const total = s.splits.reduce((n, x) => n + (Number(x.share) || 0), 0);
    const team = (() => { const v = Projects.getData("team", []); return Array.isArray(v) ? v : []; })();
    const missing = team.filter(m => m.name && !s.splits.some(x => x.name.trim().toLowerCase() === m.name.trim().toLowerCase()));
    const row = (x) => {
      const input = (key, label, attrs = {}) => {
        const i = el("input", { value: x[key] ?? "", "aria-label": label, placeholder: label, ...attrs });
        i.addEventListener("change", () => { x[key] = i.value; save(); if (key === "share") render(panel); });
        return el("td", {}, i);
      };
      const select = (key, label, options) => {
        const sel = el("select", { class: "team-select", "aria-label": label }, options.map(o => el("option", { value: o }, o || "—")));
        sel.value = x[key] ?? "";
        sel.addEventListener("change", () => { x[key] = sel.value; save(); });
        return el("td", {}, sel);
      };
      const signed = el("input", { type: "checkbox", checked: !!x.signed, "aria-label": `${x.name} has signed` });
      signed.addEventListener("change", () => { x.signed = signed.checked; x.signedOn = signed.checked ? M.todayISO() : ""; save(); render(panel); });
      return el("tr", {},
        input("name", "Writer's legal name"), select("role", "Role", ROLES), input("share", "Share %", { type: "number", min: "0", max: "100", step: "0.01", class: "mu-share" }),
        select("pro", "PRO", PROS), input("ipi", "IPI / CAE number"), input("publisher", "Publisher (and their PRO)"), input("email", "Email", { type: "email" }),
        el("td", { class: "mu-signed" }, signed, x.signedOn && el("span", { class: "media-muted" }, ` ${x.signedOn}`)),
        el("td", {}, el("button", { type: "button", class: "goal-item-remove", "aria-label": `Remove ${x.name}`, onclick: () => { s.splits.splice(s.splits.indexOf(x), 1); save(); render(panel); } }, "×")));
    };
    return el("div", { class: "mu-splits" },
      el("p", { class: "media-tip" }, "Agree the splits at the session, while everyone remembers who wrote what, and get everyone to sign. Shares are of the composition (words and music), and should add up to 100%."),
      el("div", { class: "tracker-wrap" }, el("table", { class: "tracker-table mu-split-table" },
        el("thead", {}, el("tr", {}, ["Writer", "Role", "Share %", "PRO", "IPI / CAE", "Publisher", "Email", "Signed", ""].map(h => el("th", { scope: "col" }, h)))),
        el("tbody", {}, s.splits.map(row)),
        el("tfoot", {}, el("tr", {}, el("th", { scope: "row", colspan: "2" }, "Total"),
          el("td", { class: Math.abs(total - 100) < 0.01 ? "mu-total is-ok" : "mu-total is-off" }, `${Math.round(total * 100) / 100}%`),
          el("td", { colspan: "6" }, Math.abs(total - 100) < 0.01 ? "✓ Adds up to 100%" : s.splits.length ? `Needs to add up to 100% (${total < 100 ? `${Math.round((100 - total) * 100) / 100}% missing` : `${Math.round((total - 100) * 100) / 100}% too much`})` : ""))))),
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "small-btn", onclick: () => { s.splits.push({ id: newId("sp"), name: "", role: ROLES[0], share: "", pro: "", ipi: "", publisher: "", email: "", signed: false, signedOn: "" }); save(); render(panel); } }, "+ Writer"),
        missing.length > 0 && el("button", { type: "button", class: "small-btn", onclick: () => {
          missing.forEach(m => s.splits.push({ id: newId("sp"), name: m.name, role: ROLES[0], share: "", pro: "", ipi: "", publisher: "", email: m.email || "", signed: false, signedOn: "" }));
          save(); render(panel);
        } }, `+ ${missing.length} from the Team page`),
        s.splits.length > 1 && el("button", { type: "button", class: "small-btn", onclick: () => {
          const each = Math.floor(10000 / s.splits.length) / 100;
          s.splits.forEach((x, i) => { x.share = i === 0 ? String(Math.round((100 - each * (s.splits.length - 1)) * 100) / 100) : String(each); });
          save(); render(panel);
        } }, "Split equally"),
        el("button", { type: "button", class: "small-btn", onclick: () => splitSheetPDF(s) }, "Split sheet (PDF)")));
  }

  function splitSheetPDF(s) {
    const writers = s.splits.filter(x => x.name.trim());
    M.print([
      el("h1", {}, "Song split sheet"),
      el("dl", { class: "mu-print-facts" },
        el("dt", {}, "Song"), el("dd", {}, s.title || "Untitled"),
        el("dt", {}, "Date"), el("dd", {}, M.fmtDate(M.todayISO())),
        s.length && [el("dt", {}, "Length"), el("dd", {}, s.length)]),
      el("table", { class: "mu-print-table" },
        el("thead", {}, el("tr", {}, ["Writer", "Role", "Share", "PRO", "IPI / CAE", "Publisher"].map(h => el("th", {}, h)))),
        el("tbody", {}, writers.map(x => el("tr", {}, [x.name, x.role, x.share ? `${x.share}%` : "", x.pro, x.ipi, x.publisher].map(v => el("td", {}, v || ""))))),
        el("tfoot", {}, el("tr", {}, el("th", { colspan: "2" }, "Total"), el("td", {}, `${writers.reduce((n, x) => n + (Number(x.share) || 0), 0)}%`), el("td", { colspan: "3" }, "")))),
      el("p", {}, "We agree that the shares above are our ownership of the composition (words and music) of this song."),
      el("div", { class: "mu-sign" }, writers.map(x => el("div", { class: "mu-sign-row" },
        el("span", {}, x.name), el("span", { class: "mu-sign-line" }, "Signature"), el("span", { class: "mu-sign-line mu-sign-date" }, "Date"))))],
      `Split sheet – ${s.title}`);
  }


  /* =========================================================
     SESSIONS AND VERSIONS
     ========================================================= */

  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const urls = new Map();
  async function audioUrl(id) {
    if (!id) return null;
    if (!urls.has(id)) urls.set(id, FileStore.get(id).then(b => b ? URL.createObjectURL(b) : null).catch(() => null));
    return urls.get(id);
  }

  function sessionsPart(s, all, panel) {
    const save = () => saveSongs(all);
    const team = (() => { const v = Projects.getData("team", []); return Array.isArray(v) ? v.map(m => m.name).filter(Boolean) : []; })();
    const sessions = [...s.sessions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const versions = [...s.versions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const bound = (obj, key, label, attrs = {}, textarea = false) => {
      const i = textarea ? el("textarea", { rows: "2", placeholder: label, "aria-label": label }) : el("input", { value: obj[key] ?? "", placeholder: label, "aria-label": label, ...attrs });
      if (textarea) i.value = obj[key] ?? "";
      i.addEventListener(attrs.type === "date" ? "change" : "input", () => { obj[key] = i.value; saveSoon(all); });
      return i;
    };
    return el("div", { class: "mu-two" },
      el("section", { class: "mu-col" },
        el("div", { class: "media-section-head" }, el("h3", { class: "mu-h3" }, "Sessions"),
          el("button", { type: "button", class: "small-btn", onclick: () => { s.sessions.push({ id: newId("ss"), date: M.todayISO(), place: "", people: "", recorded: "", notes: "" }); save(); render(panel); } }, "+ Session")),
        sessions.length ? el("ol", { class: "wr-claims" }, sessions.map(x => el("li", { class: "wr-claim" },
          el("div", { class: "zine-form-row" }, bound(x, "date", "Date", { type: "date" }), bound(x, "place", "Where (studio, home…)")),
          bound(x, "people", "Who was there", { list: "mu-team" }),
          bound(x, "recorded", "What got done (vocals, drums, overdubs, mix notes…)", {}, true),
          bound(x, "notes", "Settings, mic choices, things to fix next time", {}, true),
          el("div", { class: "comment-actions" }, el("button", { type: "button", class: "comment-action", onclick: () => { s.sessions.splice(s.sessions.indexOf(x), 1); save(); render(panel); } }, "Delete")))))
          : el("p", { class: "media-empty" }, "Log each session: who played, what got recorded, what to fix."),
        el("datalist", { id: "mu-team" }, team.map(n => el("option", { value: n })))),
      el("section", { class: "mu-col" },
        el("div", { class: "media-section-head" }, el("h3", { class: "mu-h3" }, "Versions"),
          el("button", { type: "button", class: "small-btn", onclick: () => {
            s.versions.push({ id: newId("vr"), name: s.versions.length ? `Mix v${s.versions.length}` : "Demo", date: M.todayISO(), file: "", link: "", status: "Rough", notes: [] });
            save(); render(panel);
          } }, "+ Version")),
        versions.length ? el("ol", { class: "wr-claims" }, versions.map(v => versionCard(v, s, all, panel)))
          : el("p", { class: "media-empty" }, "Add each demo and mix with its audio, and pin notes to times in the track (“1:23 vocal too loud”).")));
  }

  function versionCard(v, s, all, panel) {
    const save = () => saveSongs(all);
    const audio = el("audio", { controls: true, preload: "metadata", class: "mu-audio" });
    audioUrl(v.file).then(url => { if (url) audio.src = url; else if (/^https?:\/\//.test(v.link)) audio.src = v.link; });
    const file = el("input", { type: "file", accept: "audio/*", hidden: true });
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      const id = newId("aud");
      try { await FileStore.put(id, f); } catch (err) { M.setStatus(`Couldn't save the audio: ${err.message}`); return; }
      if (v.file) FileStore.remove(v.file).catch(() => {});
      v.file = id; v.fileName = f.name;
      save(); render(panel);
    });
    const note = el("input", { placeholder: "Note at the current time (Enter)", "aria-label": "Note" });
    const addNote = () => {
      if (!note.value.trim()) return;
      v.notes.push({ id: newId("vn"), at: Math.round((audio.currentTime || 0) * 10) / 10, text: note.value.trim(), by: Projects.me() || "" });
      v.notes.sort((a, b) => a.at - b.at);
      save(); render(panel);
    };
    note.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addNote(); } });
    const status = el("select", { class: "team-select", "aria-label": "Status" }, VERSION_STATUSES.map(x => el("option", { value: x }, x)));
    status.value = v.status || "Rough";
    status.addEventListener("change", () => { v.status = status.value; save(); });
    const name = el("input", { value: v.name, "aria-label": "Version name" });
    name.addEventListener("input", () => { v.name = name.value; saveSoon(all); });
    const link = el("input", { value: v.link || "", placeholder: "Or a link (Dropbox, SoundCloud, Drive…)", "aria-label": "Link" });
    link.addEventListener("change", () => { v.link = link.value.trim(); save(); });
    const date = el("input", { type: "date", value: v.date || "", "aria-label": "Date" });
    date.addEventListener("change", () => { v.date = date.value; save(); });

    return el("li", { class: `wr-claim is-${v.status === "Approved" || v.status === "Final" ? "verified" : "unchecked"}` },
      el("div", { class: "mu-version-head" }, name, date, status),
      v.file || /^https?:\/\//.test(v.link) ? audio : null,
      el("div", { class: "comment-actions" },
        file,
        el("button", { type: "button", class: "comment-action", onclick: () => file.click() }, v.file ? `Replace audio (${v.fileName || "file"})` : "Add audio file"),
        el("button", { type: "button", class: "comment-action", onclick: () => {
          if (!confirm(`Delete “${v.name}” and its notes?`)) return;
          if (v.file) FileStore.remove(v.file).catch(() => {});
          s.versions.splice(s.versions.indexOf(v), 1); save(); render(panel);
        } }, "Delete")),
      link,
      el("ol", { class: "mu-notes" }, v.notes.map(n => el("li", {},
        el("button", { type: "button", class: "mu-at", onclick: () => { audio.currentTime = n.at; audio.play().catch(() => {}); } }, fmtTime(n.at)),
        el("span", {}, n.text, n.by && el("span", { class: "media-muted" }, ` · ${n.by}`)),
        el("button", { type: "button", class: "goal-item-remove", "aria-label": "Remove note", onclick: () => { v.notes.splice(v.notes.indexOf(n), 1); save(); render(panel); } }, "×")))),
      el("div", { class: "mu-note-add" }, note, el("button", { type: "button", class: "small-btn", onclick: addNote }, "Add note")));
  }


  /* =========================================================
     EXPORT: PDFs (lyrics and chords, sheet music, both, the split
     sheet) and files (MIDI, ABC, an SVG image of the score, lyrics as text)
     ========================================================= */

  function exportMenu(s) {
    const menu = el("details", { class: "mu-export" });
    const item = (label, run, title) => el("button", { type: "button", role: "menuitem", title, onclick: () => { menu.open = false; run(); } }, label);
    const pdf = "Opens the print window: choose “Save as PDF”";
    menu.append(
      el("summary", { class: "small-btn" }, "Export ▾"),
      el("div", { class: "mu-export-menu", role: "menu", "aria-label": "Export" },
        el("p", { class: "mu-export-head" }, "PDF"),
        item("Sheet music and lyrics", () => songPDF(s, { sheet: true, lyrics: true }), pdf),
        item("Sheet music", () => songPDF(s, { sheet: true, lyrics: false }), pdf),
        item("Lyrics and chords", () => songPDF(s, { sheet: false, lyrics: true }), pdf),
        item("Split sheet", () => splitSheetPDF(s), pdf),
        el("p", { class: "mu-export-head" }, "Files"),
        item("MIDI (.mid)", () => exportMidi(s), "For GarageBand, Logic, Ableton, MuseScore…"),
        item("Sheet music as ABC (.abc)", () => exportAbc(s), "The notation as text, for MuseScore (with its ABC import), EasyABC or abcnotation.com"),
        item("Sheet music as an image (.svg)", () => exportSvg(s), "A picture of the score that stays sharp at any size"),
        item("Lyrics and chords as text (.txt)", () => exportLyrics(s), "The lyrics with chords in [square brackets]")));
    return menu;
  }
  // A click anywhere else closes an open Export menu
  document.addEventListener("click", (event) => {
    document.querySelectorAll("details.mu-export[open]").forEach(d => { if (!d.contains(event.target)) d.open = false; });
  });

  const hasSheet = (s) => {
    if (s.abc.trim() && window.ABCJS) return true;
    M.setStatus(window.ABCJS ? "There's no sheet music yet: open Sheet music to start it." : "The sheet music drawer didn't load.");
    return false;
  };
  // The score drawn off screen at print width, in black (for PDFs and the image)
  function drawOffscreen(abc) {
    const scratch = el("div", { style: "position:absolute;left:-10000px;top:0;width:720px" });
    document.body.append(scratch);
    ABCJS.renderAbc(scratch, abc, { staffwidth: 680, add_classes: true });
    const nodes = [...scratch.childNodes];
    scratch.remove();
    return nodes;
  }
  function exportMidi(s) {
    if (!hasSheet(s)) return;
    try {
      const [bytes] = ABCJS.synth.getMidiFile(s.abc, { midiOutputType: "binary" });
      M.download(new Blob([bytes], { type: "audio/midi" }), `${M.slug(s.title)}.mid`);
    } catch {
      M.setStatus("Couldn't make the MIDI file: check the sheet music for mistakes.");
    }
  }
  function exportAbc(s) {
    if (!hasSheet(s)) return;
    M.download(new Blob([s.abc.trimEnd() + "\n"], { type: "text/plain" }), `${M.slug(s.title)}.abc`);
  }
  function exportSvg(s) {
    if (!hasSheet(s)) return;
    const svg = drawOffscreen(s.abc).map(n => n.querySelector ? (n.tagName === "svg" ? n : n.querySelector("svg")) : null).find(Boolean);
    if (!svg) { M.setStatus("Couldn't draw the sheet music."); return; }
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    M.download(new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`], { type: "image/svg+xml" }), `${M.slug(s.title)}.svg`);
  }
  function exportLyrics(s) {
    if (!s.lyrics.trim()) { M.setStatus("There are no lyrics yet."); return; }
    M.download(new Blob([`${s.title || "Untitled"}\n\n${s.lyrics.trimEnd()}\n`], { type: "text/plain" }), `${M.slug(s.title)}-lyrics.txt`);
  }

  function songPDF(s, { sheet, lyrics }) {
    const writers = s.splits.filter(x => x.name.trim()).map(x => x.name);
    if (sheet && !lyrics && !hasSheet(s)) return;
    if (lyrics && !sheet && !s.lyrics.trim()) { M.setStatus("There are no lyrics yet."); return; }
    const score = sheet && s.abc.trim() && window.ABCJS ? el("div", { class: "mu-print-score" }, ...drawOffscreen(s.abc)) : null;
    M.print([
      el("h1", {}, s.title || "Untitled"),
      el("p", { class: "mu-print-meta" }, [writers.length && `Words and music by ${writers.join(", ")}`,
        s.key && `Key of ${s.key}`, s.tempo && `${s.tempo} bpm`, s.time, s.length].filter(Boolean).join(" · ")),
      score,
      lyrics && s.lyrics.trim() && el("div", { class: "mu-print-lyrics" }, lyricsView(s.lyrics, { syllableCounts: false })),
    ], `${s.title || "Song"}${sheet && !lyrics ? " – sheet music" : lyrics && !sheet ? " – lyrics" : ""}`);
  }

  M.register("songs", { render });
  M.songsApi = { normalize, parseLyrics, transposeLyrics, transposeChord, keySignature, songs, STATUSES };
})();
