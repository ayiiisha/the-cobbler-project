/* =========================================================
   music-songs.js — the Songs tab (song sketchbook) of the Music page
   ---------------------------------------------------------
   Each song has four parts:
   • Lyrics and chords: write chords in square brackets right
     where they change, e.g. "[G]Walking down the [C]road", and
     sections as a line on their own, e.g. "[Verse 1]". The
     preview shows chords above the words, with syllables per
     line. Transpose up or down a semitone.
   • Sheet music: written in ABC notation (a plain-text way of
     writing music; the buttons insert notes for you) and drawn
     as notation by abcjs. Play it back (needs the internet for
     the instrument sounds).
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
  let saveTimer = 0;
  const saveSoon = (list) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveSongs(list), 500); };

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

  function sheetPart(s, all) {
    const out = el("div", { class: "mu-score", "aria-label": "Sheet music" });
    const warnings = el("p", { class: "media-muted mu-warnings" });
    const box = el("textarea", { class: "mu-abc", spellcheck: "false", "aria-label": "ABC notation" });
    if (!s.abc.trim()) s.abc = starterAbc(s);
    box.value = s.abc;
    let timer = 0;
    const draw = () => {
      if (!window.ABCJS) { out.replaceChildren(el("p", { class: "media-empty" }, "The sheet music drawer didn't load.")); return null; }
      const [tune] = ABCJS.renderAbc(out, s.abc, { responsive: "resize", add_classes: true, foregroundColor: "currentColor" });
      warnings.textContent = tune?.warnings?.length ? `Check: ${tune.warnings.map(w => String(w).replace(/<[^>]+>/g, "")).slice(0, 3).join(" · ")}` : "";
      return tune;
    };
    box.addEventListener("input", () => { s.abc = box.value; saveSoon(all); clearTimeout(timer); timer = setTimeout(draw, 250); });
    const insert = (text) => {
      const a = box.selectionStart, b = box.selectionEnd;
      box.setRangeText(text, a, b, "end");
      box.focus();
      box.dispatchEvent(new Event("input"));
    };

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
      } catch (err) {
        synth = null;
        button.textContent = "▶ Play";
        M.setStatus("Couldn't play it: the instrument sounds load from the internet. Check your connection.");
      }
    };

    setTimeout(draw, 0);
    return el("div", { class: "mu-sheet" },
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
        })))),
      el("div", { class: "mu-two" },
        el("div", { class: "mu-col" }, box,
          el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "small-btn", onclick: (e) => play(e.currentTarget) }, "▶ Play"),
            el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm("Start the sheet music again from the template?")) { s.abc = starterAbc(s); box.value = s.abc; saveSongs(all); draw(); } } }, "Start again"),
            el("a", { class: "comment-action", href: "https://abcnotation.com/learn", target: "_blank", rel: "noopener" }, "How ABC notation works")),
          warnings),
        el("div", { class: "mu-col" }, out)),
      el("p", { class: "media-muted" }, "Notes are letters (C D E… for the octave from middle C, c d e… above it), numbers make them longer, | is a bar line, and a w: line puts lyrics under the notes. Title, time, tempo and key follow the song's details above."));
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
     EXPORT: lyrics and chords, sheet music, or both, as a PDF
     ========================================================= */

  function exportMenu(s) {
    const select = el("select", { class: "team-select", "aria-label": "Export" },
      el("option", { value: "" }, "Export PDF…"),
      el("option", { value: "both" }, "Sheet music and lyrics"),
      el("option", { value: "lyrics" }, "Lyrics and chords"),
      el("option", { value: "sheet" }, "Sheet music"),
      el("option", { value: "splits" }, "Split sheet"));
    select.addEventListener("change", () => {
      const v = select.value;
      select.value = "";
      if (v === "splits") splitSheetPDF(s);
      else if (v) songPDF(s, { sheet: v !== "lyrics", lyrics: v !== "sheet" });
    });
    return select;
  }

  function songPDF(s, { sheet, lyrics }) {
    const writers = s.splits.filter(x => x.name.trim()).map(x => x.name);
    let score = null;
    if (sheet && s.abc.trim() && window.ABCJS) {
      // Drawn off screen at print width, then moved onto the print sheet
      const scratch = el("div", { style: "position:absolute;left:-10000px;top:0;width:720px" });
      document.body.append(scratch);
      ABCJS.renderAbc(scratch, s.abc, { staffwidth: 680, add_classes: true });
      score = el("div", { class: "mu-print-score" }, ...scratch.childNodes);
      scratch.remove();
    }
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
