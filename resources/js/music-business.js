/* =========================================================
   music-business.js — Gigs, Releases and Sample clearances
   (tabs of the Music page)
   ---------------------------------------------------------
   GIGS AND BOOKINGS: each show from first enquiry to getting
   paid: venue, contact, deal and fee, times (load-in, soundcheck,
   set), a setlist from your songs, and an email to "advance"
   the show. Dates show on the Calendar.
     project.data.gigs = [{ id, date, venue, city, address, contact, email, phone, status, deal, fee,
       loadIn, soundcheck, setTime, setLength, setlist: [songId], notes, paid, received }]

   RELEASES: a plan worked back from the release date (masters,
   artwork, distributor upload, editorial pitch, press…), each
   step with its date, ticked off as you go. Steps show on the
   Calendar. Uncleared samples on the release's songs are flagged.
     project.data.releases = [{ id, title, type, date, distributor, upc, songs: [songId],
       isrc: { songId: code }, tasks: [{ id, label, offset, done }], notes }]

   SAMPLE CLEARANCES: every sample, who owns the recording and
   the song, what you used, and where clearance stands.
     project.data.samples = [{ id, songId, artist, title, used, rights, masterOwner,
       publisher, contact, status, fee, terms, deadline, docs, notes }]

   Needs music-core.js (and music-songs.js for song names).
   ========================================================= */
(() => {

  const M = window.MusicPage;
  if (!M) return;
  const { el, newId } = M;

  const songList = () => M.list("songs");
  const songName = (id) => songList().find(s => s.id === id)?.title || "Untitled";
  const money = (n) => (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: (() => { try { return localStorage.getItem("writingCurrency") || "USD"; } catch { return "USD"; } })(), maximumFractionDigits: 0 });

  // A field bound to obj[key]; save() runs on change
  function bound(obj, key, label, save, { type = "text", textarea = false, rows = 2, placeholder = "", redraw = null, attrs = {} } = {}) {
    const i = textarea ? el("textarea", { rows: String(rows), placeholder, "aria-label": label }) : el("input", { type, placeholder, "aria-label": label, ...attrs });
    i.value = obj[key] ?? "";
    i.addEventListener(type === "date" || type === "time" || redraw ? "change" : "input", () => { obj[key] = type === "number" ? i.value : i.value; save(); redraw?.(); });
    return el("label", { class: "wr-field" }, label, i);
  }
  function choice(obj, key, label, options, save, redraw) {
    const s = el("select", { class: "team-select", "aria-label": label }, options.map(o => Array.isArray(o) ? el("option", { value: o[0] }, o[1]) : el("option", { value: o }, o || "—")));
    s.value = obj[key] ?? (Array.isArray(options[0]) ? options[0][0] : options[0]);
    s.addEventListener("change", () => { obj[key] = s.value; save(); redraw?.(); });
    return el("label", { class: "wr-field" }, label, s);
  }


  /* =========================================================
     GIGS AND BOOKINGS
     ========================================================= */

  const GIG_STATUSES = ["Enquiry", "Hold", "Confirmed", "Advanced", "Played", "Paid", "Cancelled"];
  const DEALS = ["Guarantee", "Door split", "Guarantee vs. door", "Ticket split", "Flat fee (private event)", "Free / showcase", "Other"];
  let showPast = false;

  function renderGigs(panel) {
    const gigs = M.list("gigs");
    const save = () => M.saveList("gigs", gigs);
    const today = M.todayISO();
    const upcoming = gigs.filter(g => (g.date || "9999") >= today && g.status !== "Cancelled").sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    const past = gigs.filter(g => !upcoming.includes(g)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const earned = gigs.filter(g => g.paid).reduce((n, g) => n + (Number(g.received || g.fee) || 0), 0);
    const owed = gigs.filter(g => g.status === "Played" && !g.paid).reduce((n, g) => n + (Number(g.fee) || 0), 0);
    const redraw = () => renderGigs(panel);

    M.fill(panel,
      el("div", { class: "wr-stats" },
        stat("Coming up", String(upcoming.filter(g => ["Confirmed", "Advanced"].includes(g.status)).length), `${upcoming.filter(g => ["Enquiry", "Hold"].includes(g.status)).length} on hold or enquired`),
        stat("Earned", money(earned), "paid"), stat("Owed", money(owed), "played, not paid yet")),
      el("div", { class: "sketch-nav" },
        el("button", { type: "button", class: "small-btn", onclick: () => {
          gigs.push({ id: newId("gig"), date: "", venue: "", city: "", address: "", contact: "", email: "", phone: "", status: "Enquiry", deal: DEALS[0], fee: "",
            loadIn: "", soundcheck: "", setTime: "", setLength: "", setlist: [], notes: "", paid: "", received: "" });
          save(); redraw();
        } }, "+ Gig"),
        el("label", { class: "tool-group" }, el("input", { type: "checkbox", checked: showPast, onchange: (e) => { showPast = e.target.checked; redraw(); } }), ` Show past and cancelled (${past.length})`)),
      upcoming.length ? el("div", { class: "research-grid" }, upcoming.map(g => gigCard(g, gigs, save, redraw))) : el("p", { class: "media-empty" }, "No gigs coming up."),
      showPast && past.length > 0 && el("h2", { class: "iv-h2" }, "Past and cancelled"),
      showPast && past.length > 0 && el("div", { class: "research-grid" }, past.map(g => gigCard(g, gigs, save, redraw))));
  }

  const stat = (label, value, note = "") => el("div", { class: "wr-stat" }, el("span", { class: "wr-stat-value" }, value), el("span", { class: "wr-stat-label" }, label), note && el("span", { class: "media-muted" }, note));

  function gigCard(g, gigs, save, redraw) {
    g.setlist = Array.isArray(g.setlist) ? g.setlist : [];
    const songs = songList();
    const length = g.setlist.reduce((n, id) => {
      const t = String(songs.find(s => s.id === id)?.length || "").match(/^(\d+):(\d{2})$/);
      return n + (t ? Number(t[1]) * 60 + Number(t[2]) : 0);
    }, 0);
    const add = el("select", { class: "team-select", "aria-label": "Add a song to the setlist" },
      el("option", { value: "" }, songs.length ? "+ Add a song…" : "No songs yet (Songs tab)"),
      songs.map(s => el("option", { value: s.id }, s.title || "Untitled")));
    add.addEventListener("change", () => { if (add.value) { g.setlist.push(add.value); save(); redraw(); } });
    const advance = () => {
      const lines = [
        `Hi ${g.contact || "there"},`, "",
        `Looking forward to playing ${g.venue || "your venue"}${g.date ? ` on ${M.fmtDate(g.date)}` : ""}! Could you confirm a few details?`, "",
        `• Load-in time${g.loadIn ? ` (we have ${g.loadIn})` : ""}`,
        `• Soundcheck${g.soundcheck ? ` (we have ${g.soundcheck})` : ""}`,
        `• Set time and length${g.setTime ? ` (we have ${g.setTime}${g.setLength ? `, ${g.setLength} minutes` : ""})` : ""}`,
        "• Backline and PA: what's provided, and is there an engineer?",
        "• Parking and where to load in", "• Guest list and hospitality",
        `• Payment: ${g.deal || "deal"}${g.fee ? `, ${money(g.fee)}` : ""}; how and when it's paid`, "",
        "Thanks!", Projects.me() || ""];
      return lines.join("\n");
    };
    return el("article", { class: `research-card mu-gig is-${g.status.toLowerCase()}` },
      el("div", { class: "research-card-head" },
        el("input", { class: "wr-bible-name", value: g.venue, placeholder: "Venue", "aria-label": "Venue", oninput: (e) => { g.venue = e.target.value; save(); } }),
        el("span", { class: "pitch-pill" }, g.status)),
      el("div", { class: "zine-form-row" }, bound(g, "date", "Date", save, { type: "date", redraw }), choice(g, "status", "Status", GIG_STATUSES, save, redraw)),
      el("div", { class: "zine-form-row" }, bound(g, "city", "City", save), bound(g, "address", "Address", save)),
      el("div", { class: "zine-form-row" }, bound(g, "contact", "Booker / contact", save), bound(g, "email", "Email", save, { type: "email" }), bound(g, "phone", "Phone", save, { type: "tel" })),
      el("div", { class: "zine-form-row" }, choice(g, "deal", "Deal", DEALS, save), bound(g, "fee", "Fee / guarantee", save, { type: "number" })),
      el("div", { class: "zine-form-row" }, bound(g, "loadIn", "Load-in", save, { type: "time" }), bound(g, "soundcheck", "Soundcheck", save, { type: "time" }),
        bound(g, "setTime", "Set time", save, { type: "time" }), bound(g, "setLength", "Set (minutes)", save, { type: "number" })),
      el("div", { class: "wr-field" }, `Setlist${g.setlist.length ? ` · ${g.setlist.length} songs${length ? `, about ${Math.round(length / 60)} min` : ""}` : ""}`,
        el("ol", { class: "mu-setlist" }, g.setlist.map((id, i) => el("li", {},
          el("span", {}, songName(id)),
          el("span", { class: "wr-mini" },
            el("button", { type: "button", class: "goal-item-remove wr-move", disabled: i === 0, "aria-label": "Move up", onclick: () => { g.setlist.splice(i - 1, 0, g.setlist.splice(i, 1)[0]); save(); redraw(); } }, "↑"),
            el("button", { type: "button", class: "goal-item-remove wr-move", disabled: i === g.setlist.length - 1, "aria-label": "Move down", onclick: () => { g.setlist.splice(i + 1, 0, g.setlist.splice(i, 1)[0]); save(); redraw(); } }, "↓"),
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": "Remove from setlist", onclick: () => { g.setlist.splice(i, 1); save(); redraw(); } }, "×"))))),
        add),
      bound(g, "notes", "Notes (backline, hospitality, merch, who's on the bill)", save, { textarea: true }),
      el("div", { class: "zine-form-row" }, bound(g, "paid", "Paid on", save, { type: "date", redraw }), bound(g, "received", "Amount received", save, { type: "number" })),
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "comment-action", onclick: async () => { try { await navigator.clipboard.writeText(advance()); M.setStatus("Advance email copied: paste it into an email to the venue."); } catch { prompt("Copy:", advance()); } } }, "Copy advance email"),
        g.setlist.length > 0 && el("button", { type: "button", class: "comment-action", onclick: () => M.print([
          el("h1", { class: "mu-setlist-print-title" }, `${g.venue || "Setlist"}${g.date ? ` · ${M.fmtDate(g.date)}` : ""}`),
          el("ol", { class: "mu-setlist-print" }, g.setlist.map(id => {
            const s = songList().find(x => x.id === id);
            return el("li", {}, s?.title || "Untitled", s?.key && el("span", { class: "mu-setlist-key" }, ` ${s.key}`));
          }))], `Setlist – ${g.venue || "gig"}`) }, "Print setlist"),
        el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm("Delete this gig?")) { gigs.splice(gigs.indexOf(g), 1); save(); redraw(); } } }, "Delete")));
  }


  /* =========================================================
     RELEASES
     ========================================================= */

  const RELEASE_TYPES = ["Single", "EP", "Album", "Music video", "Remix"];
  // Steps before (negative) and after the release date, in days. Change these to suit.
  const RELEASE_STEPS = [
    [-56, "Final masters approved by everyone (and stems saved)"],
    [-49, "Artwork finished (3000 × 3000 px, no URLs or logos) and credits checked"],
    [-42, "Song registered with your PRO and publisher; ISRC codes ready (your distributor can assign them)"],
    [-42, "Every sample cleared (Sample clearances tab)"],
    [-35, "Split sheets signed (Songs › Split sheet)"],
    [-28, "Uploaded to your distributor (most ask for 3–4 weeks before release)"],
    [-21, "Pitched to Spotify editorial in Spotify for Artists (at least 7 days ahead; earlier is better)"],
    [-21, "Pre-save link live"],
    [-14, "Press release out; pitched to blogs, radio and playlist curators"],
    [-14, "Music video or visualiser ready (Storyboarder)"],
    [-7, "Social posts and teaser clips scheduled"],
    [0, "Release day: share it everywhere and thank everyone who helped"],
    [7, "Check stats; pitch to more playlists with first-week numbers"],
    [28, "Lyrics on lyric sites, Content ID set up, follow-up posts"],
  ];

  function renderReleases(panel) {
    const releases = M.list("releases");
    const save = () => M.saveList("releases", releases);
    const redraw = () => renderReleases(panel);
    const sorted = [...releases].sort((a, b) => (b.date || "9999").localeCompare(a.date || "9999"));
    M.fill(panel,
      el("p", { class: "media-tip" }, "Set a release date and the plan works back from it. Every step's date shows on the Calendar."),
      el("button", { type: "button", class: "small-btn", onclick: () => {
        releases.push({ id: newId("rel"), title: "", type: "Single", date: "", distributor: "", upc: "", songs: [], isrc: {}, notes: "",
          tasks: RELEASE_STEPS.map(([offset, label]) => ({ id: newId("rt"), offset, label, done: false })) });
        save(); redraw();
      } }, "+ Release"),
      sorted.length ? sorted.map(r => releaseCard(r, releases, save, redraw)) : el("p", { class: "media-empty" }, "Plan a single, EP or album."));
  }

  function releaseCard(r, releases, save, redraw) {
    r.songs = Array.isArray(r.songs) ? r.songs : [];
    r.isrc = r.isrc && typeof r.isrc === "object" ? r.isrc : {};
    r.tasks = Array.isArray(r.tasks) ? r.tasks : [];
    const today = M.todayISO();
    const songs = songList();
    const samples = M.list("samples").filter(x => r.songs.includes(x.songId) && !["Cleared", "Replaced", "Not needed"].includes(x.status));
    const unsigned = songs.filter(s => r.songs.includes(s.id) && (!(s.splits || []).length || (s.splits || []).some(x => !x.signed)));
    const tasks = [...r.tasks].sort((a, b) => a.offset - b.offset);
    const done = tasks.filter(t => t.done).length;
    const add = el("select", { class: "team-select", "aria-label": "Add a song" }, el("option", { value: "" }, "+ Add a song…"),
      songs.filter(s => !r.songs.includes(s.id)).map(s => el("option", { value: s.id }, s.title || "Untitled")));
    add.addEventListener("change", () => { if (add.value) { r.songs.push(add.value); save(); redraw(); } });

    return el("section", { class: "media-section mu-release" },
      el("div", { class: "media-section-head" },
        el("input", { class: "wr-bible-name mu-release-title", value: r.title, placeholder: "Release title", "aria-label": "Release title", oninput: (e) => { r.title = e.target.value; save(); } }),
        el("span", { class: "pk-count" }, `${done} / ${tasks.length} done`)),
      el("div", { class: "mu-facts" },
        choice(r, "type", "Type", RELEASE_TYPES, save),
        bound(r, "date", "Release date", save, { type: "date", redraw }),
        bound(r, "distributor", "Distributor", save, { placeholder: "DistroKid, CD Baby, label…" }),
        bound(r, "upc", "UPC", save)),
      (samples.length > 0 || unsigned.length > 0) && el("ul", { class: "mu-warnings-list" },
        samples.length > 0 && el("li", {}, `${samples.length} sample${samples.length === 1 ? " isn't" : "s aren't"} cleared yet: ${[...new Set(samples.map(x => songName(x.songId)))].join(", ")}`),
        unsigned.length > 0 && el("li", {}, `Split sheets not signed by everyone: ${unsigned.map(s => s.title || "Untitled").join(", ")}`)),
      el("div", { class: "mu-two" },
        el("div", { class: "mu-col" },
          el("h3", { class: "mu-h3" }, "Tracks"),
          el("ol", { class: "mu-setlist" }, r.songs.map((id, i) => {
            const code = el("input", { value: r.isrc[id] || "", placeholder: "ISRC (e.g. USABC2600001)", "aria-label": `ISRC for ${songName(id)}`, class: "mu-isrc" });
            code.addEventListener("change", () => { r.isrc[id] = code.value.trim().toUpperCase(); save(); });
            return el("li", {}, el("span", {}, songName(id)), code,
              el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": "Remove track", onclick: () => { r.songs.splice(i, 1); delete r.isrc[id]; save(); redraw(); } }, "×"));
          })),
          add,
          bound(r, "notes", "Notes", save, { textarea: true })),
        el("div", { class: "mu-col" },
          el("h3", { class: "mu-h3" }, "The plan"),
          !r.date && el("p", { class: "media-muted" }, "Set the release date to see when each step is due."),
          el("ul", { class: "mu-tasks" }, tasks.map(t => {
            const due = r.date ? M.addDays(r.date, t.offset) : "";
            const late = !t.done && due && due < today;
            const box = el("input", { type: "checkbox", checked: !!t.done, "aria-label": t.label });
            box.addEventListener("change", () => { t.done = box.checked; save(); redraw(); });
            return el("li", { class: `mu-task${t.done ? " is-done" : ""}${late ? " is-late" : ""}` },
              el("label", { class: "pk-deliverable" }, box,
                el("span", {},
                  el("span", { class: "mu-task-when" }, due ? M.fmtDate(due) : `${t.offset === 0 ? "Release day" : t.offset < 0 ? `${-t.offset} days before` : `${t.offset} days after`}`),
                  el("span", {}, t.label))),
              el("button", { type: "button", class: "goal-item-remove", "aria-label": "Remove step", onclick: () => { r.tasks.splice(r.tasks.indexOf(t), 1); save(); redraw(); } }, "×"));
          })),
          el("button", { type: "button", class: "comment-action", onclick: () => {
            const label = prompt("New step:");
            if (!label?.trim()) return;
            const days = Number(prompt("How many days before release? (Use a minus sign for after, e.g. -7 is a week after)", "14"));
            r.tasks.push({ id: newId("rt"), offset: -(Number.isFinite(days) ? days : 0), label: label.trim(), done: false });
            save(); redraw();
          } }, "+ Step"))),
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "comment-action", onclick: () => packageRelease(r), title: "YouTube and Shorts packages for the music video and teasers, sharing keywords" }, "Package the video"),
        el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm(`Delete the release “${r.title || "untitled"}”?`)) { releases.splice(releases.indexOf(r), 1); save(); redraw(); } } }, "Delete release")));
  }


  /* A YouTube package for the music video and a Shorts/Reels one for teasers, as one story */
  function packageRelease(r) {
    const packages = M.list("packaging");
    const storyId = newId("s");
    const artist = Projects.me();
    const title = r.title || "New release";
    const make = (platform, name, text) => ({
      id: newId("pk"), name, platform, storyId, releaseId: r.id, keyword: title, keywords: artist ? [artist] : [], audience: "", notes: "",
      titles: [{ id: newId("t"), text, chosen: true }], thumbs: [],
      description: `${title}${artist ? ` by ${artist}` : ""}${r.date ? `, out ${M.fmtDate(r.date)}` : ""}.`, tags: [], hashtags: [],
      images: [], seoTitle: "", metaDescription: "", slug: "", shareTitle: "", shareDescription: "", previewText: "",
      deliverables: { done: {}, custom: [] }, created: Date.now(), updated: Date.now(),
    });
    const video = make("youtube", `${title}: music video`, `${artist ? `${artist} - ` : ""}${title} (Official Video)`);
    packages.push(video, make("short", `${title}: teasers`, title));
    M.saveList("packaging", packages);
    try { localStorage.setItem(`packagingCurrent:${Projects.activeId()}`, video.id); } catch {}
    location.href = "packaging.html";
  }


  /* =========================================================
     SAMPLE CLEARANCES
     ========================================================= */

  const SAMPLE_STATUSES = ["Not started", "Requested", "Negotiating", "Cleared", "Denied", "Replaced", "Not needed"];
  const RIGHTS = [["both", "Recording and song (a direct sample)"], ["song", "Song only (replayed / interpolated)"], ["master", "Recording only"]];
  let sampleFilter = "";

  function renderSamples(panel) {
    const samples = M.list("samples");
    const save = () => M.saveList("samples", samples);
    const redraw = () => renderSamples(panel);
    const songs = songList();
    const shown = samples.filter(x => !sampleFilter || x.status === sampleFilter);
    M.fill(panel,
      el("p", { class: "media-tip" }, "A direct sample needs permission from whoever owns the recording (usually the label) and the song (the publisher). Replaying it yourself only needs the publisher. Keep every email and agreement."),
      el("div", { class: "sketch-nav" },
        el("button", { type: "button", class: "small-btn", onclick: () => {
          samples.push({ id: newId("smp"), songId: "", artist: "", title: "", used: "", rights: "both", masterOwner: "", publisher: "", contact: "", status: "Not started", fee: "", terms: "", deadline: "", docs: "", notes: "" });
          sampleFilter = ""; save(); redraw();
        } }, "+ Sample"),
        el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "Show" },
          ["", ...SAMPLE_STATUSES].map(st => el("button", { type: "button", "aria-pressed": String(sampleFilter === st), onclick: () => { sampleFilter = st; redraw(); } },
            `${st || "All"} (${samples.filter(x => !st || x.status === st).length})`)))),
      shown.length ? el("div", { class: "research-grid" }, shown.map(x => {
        const cleared = ["Cleared", "Replaced", "Not needed"].includes(x.status);
        return el("article", { class: `research-card mu-sample${cleared ? " is-cleared" : x.status === "Denied" ? " is-denied" : ""}` },
          el("div", { class: "research-card-head" },
            el("input", { class: "wr-bible-name", value: x.title, placeholder: "Sampled song", "aria-label": "Sampled song", oninput: (e) => { x.title = e.target.value; save(); } }),
            el("span", { class: "pitch-pill" }, x.status)),
          el("div", { class: "zine-form-row" }, bound(x, "artist", "By (artist)", save), choice(x, "songId", "Used in", [["", "—"], ...songs.map(s => [s.id, s.title || "Untitled"])], save)),
          bound(x, "used", "What you used (time in the original, how it's used)", save, { placeholder: "e.g. drum break 0:45–0:52, looped; vocal chop" }),
          choice(x, "rights", "Clearance needed for", RIGHTS, save, redraw),
          el("div", { class: "zine-form-row" },
            x.rights !== "song" && bound(x, "masterOwner", "Recording owner (label)", save),
            x.rights !== "master" && bound(x, "publisher", "Song owner (publisher)", save)),
          bound(x, "contact", "Who you're talking to", save),
          el("div", { class: "zine-form-row" }, choice(x, "status", "Status", SAMPLE_STATUSES, save, redraw), bound(x, "deadline", "Need it by", save, { type: "date" })),
          el("div", { class: "zine-form-row" }, bound(x, "fee", "Fee", save), bound(x, "terms", "Terms (royalty %, credit, publishing split)", save)),
          bound(x, "docs", "Agreement (link or where it's filed)", save),
          bound(x, "notes", "Notes", save, { textarea: true }),
          el("div", { class: "comment-actions" }, el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm("Delete this sample?")) { samples.splice(samples.indexOf(x), 1); save(); redraw(); } } }, "Delete")));
      })) : el("p", { class: "media-empty" }, samples.length ? "Nothing with that status." : "Log every sample as soon as you use it: it's much easier than tracing it later."));
  }

  M.register("gigs", { render: renderGigs });
  M.register("releases", { render: renderReleases });
  M.register("samples", { render: renderSamples });
  M.RELEASE_STEPS = RELEASE_STEPS;
})();
