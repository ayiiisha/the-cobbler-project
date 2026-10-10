/* =========================================================
   report.js — everything in a project, as one document
   ---------------------------------------------------------
   ProjectReport.blocks(projectId) gathers what each page has
   saved in the project into a document (see doc-export.js for
   the block format), skipping sections that are empty:

     Project Tracker details and goals · Team · Tasks · Research ·
     Interviews (people and questions) · Pitches · Packaging · Ideas ·
     Calendar events · Writing · Screenplays · Music · Paper edits · Storyboards · Zines ·
     Media & transcripts · Datasets · Resources · Comments

   Drawings, uploaded files and transcript text aren't included
   (only their names and counts); the project backup (.json)
   keeps everything.

     ProjectReport.pdf(projectId)    print window → "Save as PDF"
     ProjectReport.docx(projectId)   downloads a Word document

   Needs projects-core.js, zip.js and doc-export.js.
   ========================================================= */
(() => {

  const fmtDate = (value) => {
    if (!value) return "";
    const d = typeof value === "number" ? new Date(value) : new Date(String(value).length === 10 ? value + "T00:00:00" : value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  const list = (v) => Array.isArray(v) ? v : [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const filled = (pairs) => pairs.filter(([, v]) => v != null && String(v).trim() !== "");
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  const seconds = (s) => { const t = Math.round(s || 0); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

  function blocks(projectId) {
    const info = Projects.info().find(p => p.id === projectId);
    if (!info) return [];
    const get = (key, fallback) => Projects.getDataFor(projectId, key, fallback) ?? fallback;
    const out = [
      { t: "title", text: info.name },
      { t: "meta", text: [info.description, `Created ${fmtDate(info.created)} · Last edited ${fmtDate(info.updated)}${info.archived ? " · Archived" : ""}`,
                          `Exported from The Cobbler Project on ${fmtDate(Date.now())}`].filter(Boolean).join("\n") },
    ];
    const section = (title, content) => { if (content.length) out.push({ t: "h1", text: title }, ...content); };

    /* ---------- Project Tracker ---------- */
    const tracker = get("tracker", {}) || {};
    const trackerFields = filled([
      ["Medium", tracker.medium], ["Status", tracker.status], ["In progress", tracker.inProgress], ["Next up", tracker.nextUp],
      ["Began on", fmtDate(tracker.beganOn)], ["Target completion", fmtDate(tracker.targetCompletion)],
      ["Target publication", fmtDate(tracker.targetPublication)], ["Finished on", fmtDate(tracker.finishedOn)],
      ["Published on", fmtDate(tracker.publishedOn)], ["Pitch document", tracker.pitchLink], ["Final product", tracker.finalLink],
      ["Taxonomy", tracker.taxonomy], ["Team (typed)", tracker.team], ["Notes", tracker.notes],
    ]);
    const goals = list(tracker.goals).filter(g => g.name || list(g.tasks).some(t => t.text) || g.people || list(g.barriers).some(Boolean));
    const trackerBlocks = trackerFields.length ? [{ t: "fields", items: trackerFields }] : [];
    goals.forEach((g, i) => {
      trackerBlocks.push({ t: "h2", text: `Goal #${i + 1}: ${g.name || "Untitled"}` },
        { t: "fields", items: filled([["Status", g.status], ["People involved", g.people]]) });
      const tasks = list(g.tasks).filter(t => t.text?.trim());
      if (tasks.length) trackerBlocks.push({ t: "checks", items: tasks.map(t => ({ text: t.text, done: t.done })) });
      const barriers = list(g.barriers).filter(b => b?.trim());
      if (barriers.length) trackerBlocks.push({ t: "p", text: "Barriers:" }, { t: "list", items: barriers });
    });
    section("Project Tracker", trackerBlocks);

    /* ---------- Team ---------- */
    const team = list(get("team", []));
    section("Team", team.length ? [{ t: "table", head: ["Name", "Roles", "Contact", "Notes"], rows: team.map(m => [
      [m.name, m.pronouns && `(${m.pronouns})`].filter(Boolean).join(" "),
      list(m.roles).join(", "),
      [m.email, m.phone, m.other, m.location, m.preferred && `Prefers: ${m.preferred}`].filter(Boolean).join("\n"),
      m.notes || "",
    ]) }] : []);

    /* ---------- Tasks (Team page) ---------- */
    const teamTasks = list(get("tasks", [])).filter(t => t.text?.trim());
    section("Tasks", teamTasks.length ? [{ t: "table", head: ["Done", "Task", "Assigned to", "Due"], rows: teamTasks.map(t => [
      t.done ? "Yes" : "", t.text, t.assignee || "", fmtDate(t.due),
    ]) }] : []);

    /* ---------- Research ---------- */
    const research = list(get("research", []));
    section("Research", research.flatMap(n => {
      const sources = list(n.sources).length ? list(n.sources) : (n.source ? [n.source] : []);
      return [
        { t: "h2", text: `${n.title || "Untitled"} (${{ verified: "Verified", disputed: "Disputed" }[n.status] || "Unverified"})` },
        { t: "fields", items: filled([["To check", n.claim], ["Tags", list(n.tags).join(", ")]]) },
        ...(sources.length ? [{ t: "p", text: "Sources:" }, { t: "list", items: sources }] : []),
        ...(n.body ? [{ t: "p", text: n.body }] : []),
      ];
    }));

    /* ---------- Interviews ---------- */
    const people = list(get("interviewees", []));
    const questions = list(get("questions", []));
    const ivBlocks = [];
    if (people.length) {
      ivBlocks.push({ t: "table", head: ["Name", "Stage", "Shoot", "Release", "Checklist"], rows: people.map(p => [
        [p.name, p.role].filter(Boolean).join("\n"),
        p.stage || "",
        [fmtDate(p.shootDate), p.shootTime, p.location].filter(Boolean).join(" · "),
        [p.release?.status, fmtDate(p.release?.date)].filter(Boolean).join(", "),
        list(p.checklist).length ? `${list(p.checklist).filter(c => c.done).length}/${list(p.checklist).length}` : "",
      ]) });
      people.forEach(p => {
        const picked = questions.filter(q => list(p.questionIds).includes(q.id));
        if (picked.length) ivBlocks.push({ t: "h2", text: `Questions for ${p.name}` }, { t: "checks", items: picked.map(q => q.text) });
      });
    }
    if (questions.length) {
      ivBlocks.push({ t: "h2", text: "Question bank" });
      [...new Set(questions.map(q => q.category || "General"))].forEach(topic =>
        ivBlocks.push({ t: "p", text: `${topic}:` }, { t: "list", items: questions.filter(q => (q.category || "General") === topic).map(q => q.text) }));
    }
    section("Interviews", ivBlocks);

    /* ---------- Pitches ---------- */
    section("Pitches", list(get("pitches", [])).flatMap(p => [
      { t: "h2", text: `${p.title || "Untitled pitch"} (${p.status || "Drafting"})` },
      ...(p.hook ? [{ t: "p", text: p.hook }] : []),
      { t: "fields", items: filled([["The story", p.story], ["Why now", p.whyNow], ["Why me / access", p.access],
        ["Format", [p.format, p.length].filter(Boolean).join(", ")], ["Audience", p.audience], ["Notes", p.notes]]) },
      ...(list(p.links).length ? [{ t: "p", text: "Links:" }, { t: "list", items: list(p.links) }] : []),
      ...(list(p.outlets).length ? [{ t: "table", head: ["Outlet", "Editor", "Sent", "Status", "Notes"],
        rows: list(p.outlets).map(o => [o.name, [o.editor, o.email].filter(Boolean).join("\n"), fmtDate(o.sentOn), o.status, o.notes || ""]) }] : []),
    ]));

    /* ---------- Packaging ---------- */
    const PLATFORM_NAMES = { youtube: "YouTube video", short: "Shorts, Reels or TikTok", instagram: "Instagram post", article: "Article or web page",
      newsletter: "Newsletter", zine: "Zine shop listing", podcast: "Podcast episode", other: "Other" };
    section("Packaging", list(get("packaging", [])).flatMap(k => {
      const titles = list(k.titles).filter(t => t.text?.trim());
      const chosen = titles.find(t => t.chosen) || titles[0];
      const thumb = list(k.thumbs).find(t => t.chosen) || list(k.thumbs)[0];
      return [
        { t: "h2", text: [k.name, PLATFORM_NAMES[k.platform] || k.platform].filter(Boolean).join(" · ") || "Package" },
        { t: "fields", items: filled([["Title", chosen?.text], ["Keywords", [k.keyword, ...list(k.keywords)].filter(Boolean).join(", ")],
          ["Audience", k.audience], ["Preview text", k.previewText], ["Description", k.description],
          ["Tags", list(k.tags).join(", ")], ["Hashtags", list(k.hashtags).map(h => "#" + h).join(" ")],
          ["Thumbnail", thumb && [thumb.text, thumb.notes].filter(Boolean).join(" — ")],
          ["SEO title", k.seoTitle], ["Meta description", k.metaDescription], ["URL slug", k.slug]]) },
        ...(titles.length > 1 ? [{ t: "p", text: "Other title ideas:" }, { t: "list", items: titles.filter(t => t !== chosen).map(t => t.text) }] : []),
        ...(list(k.images).some(i => i.alt?.trim()) ? [{ t: "p", text: "Alt text:" },
          { t: "list", items: list(k.images).filter(i => i.alt?.trim()).map(i => `${i.label || "Image"}: ${i.alt}`) }] : []),
      ];
    }));

    /* ---------- Ideas ---------- */
    const ideas = list(get("ideas", [])).filter(i => i.text?.trim());
    const columns = list(get("ideaColumns", ["Raw ideas", "Developing", "Ready to pitch"]));
    section("Ideas", [0, 1, 2].flatMap(c => {
      const items = ideas.filter(i => i.column === c).map(i => i.text.trim());
      return items.length ? [{ t: "h2", text: columns[c] || `Column ${c + 1}` }, { t: "list", items }] : [];
    }));

    /* ---------- Calendar ---------- */
    const events = list(get("calendarEvents", [])).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    section("Calendar events", events.length ? [{ t: "table", head: ["Date", "Time", "What", "Notes"],
      rows: events.map(e => [fmtDate(e.date), e.time || "All day", e.title, e.notes || ""]) }] : []);

    /* ---------- Writing ---------- */
    const drafts = list(get("drafts", []));
    section("Writing", drafts.flatMap(d => {
      const scenes = list(d.parts).flatMap(p => list(p.scenes));
      const words = scenes.reduce((n, s) => n + (String(s.text || "").match(/\S+/g) || []).length, 0);
      const claims = list(d.claims);
      return [
        { t: "h2", text: `${d.title || "Untitled"} (${d.kind === "fiction" ? "fiction" : "article"})` },
        { t: "fields", items: filled([["Words", `${words}${d.target ? ` of ${d.target}` : ""}`], ["Deadline", fmtDate(d.deadline)],
          ["Claims verified", claims.length ? `${claims.filter(c => c.status === "Verified").length} of ${claims.length}` : ""],
          ["Versions", list(d.versions).map(v => v.label).join(", ")]]) },
        ...list(d.parts).flatMap(p => [
          ...(list(d.parts).length > 1 && p.title ? [{ t: "p", text: p.title.toUpperCase() }] : []),
          ...list(p.scenes).filter(s => String(s.text || "").trim()).flatMap(s => [
            ...(s.title ? [{ t: "p", text: s.title }] : []),
            ...String(s.text).split(/\n+/).filter(x => x.trim()).map(text => ({ t: "p", text })),
          ]),
        ]),
      ];
    }));
    const sources = list(get("sourceLog", []));
    section("Sources", sources.length ? [{ t: "table", head: ["Name", "Who", "Attribution", "Agreed", "Contacts"],
      rows: sources.map(x => [x.name, x.role || "", x.attribution || "", x.agreement || "", String(list(x.log).length)]) }] : []);
    const requests = list(get("recordsRequests", []));
    section("Records requests", requests.length ? [{ t: "table", head: ["Agency", "Request", "Sent", "Status"],
      rows: requests.map(r => [r.agency || "", r.description || "", fmtDate(r.sent), r.status || ""]) }] : []);
    const timeline = list(get("eventTimeline", [])).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    section("Event timeline", timeline.length ? [{ t: "table", head: ["Date", "What happened", "Source"],
      rows: timeline.map(e => [`${e.date || ""} ${e.time || ""}`.trim(), [e.title, e.detail].filter(Boolean).join("\n"), e.source || ""]) }] : []);
    const subs = list(get("submissions", []));
    section("Submissions", subs.length ? [{ t: "table", head: ["Outlet", "Piece", "Sent", "Status", "Fee", "Paid"],
      rows: subs.map(x => [x.outlet || "", x.piece || "", fmtDate(x.sent), x.status || "", x.fee || "", fmtDate(x.paid)]) }] : []);

    /* ---------- Screenplays ---------- */
    const plays = list(get("screenplays", []));
    section("Screenplays", plays.flatMap(sp => {
      const els = list(sp.elements).filter(e => String(e.text || "").trim());
      const scenes = els.filter(e => e.type === "scene");
      return [{ t: "h2", text: sp.title || "Untitled script" },
        { t: "fields", items: filled([["Written by", sp.author], ["Draft", sp.draftDate], ["Scenes", String(scenes.length)]]) },
        ...(scenes.length ? [{ t: "list", items: scenes.map((e, i) => `${i + 1}. ${String(e.text).toUpperCase()}`) }] : [])];
    }));

    /* ---------- Music ---------- */
    const songsList = list(get("songs", []));
    section("Songs", songsList.flatMap(s => [
      { t: "h2", text: `${s.title || "Untitled"} (${s.status || "Idea"})` },
      { t: "fields", items: filled([["Key", s.key], ["Tempo", s.tempo && `${s.tempo} bpm`], ["Time", s.time], ["Length", s.length],
        ["Writers", list(s.splits).map(x => `${x.name}${x.share ? ` ${x.share}%` : ""}${x.signed ? " (signed)" : ""}`).join(", ")],
        ["Versions", list(s.versions).map(v => `${v.name} (${v.status || "Rough"})`).join(", ")]]) },
      ...(String(s.lyrics || "").trim() ? [{ t: "p", text: String(s.lyrics).replace(/\[([^\]\n]+)\]/g, (m, c) => /^[A-G]/.test(c) && c.length < 9 ? "" : m) }] : []),
    ]));
    const gigsList = list(get("gigs", []));
    section("Gigs", gigsList.length ? [{ t: "table", head: ["Date", "Venue", "Status", "Deal", "Fee"],
      rows: gigsList.map(g => [fmtDate(g.date), [g.venue, g.city].filter(Boolean).join(", "), g.status || "", g.deal || "", g.fee || ""]) }] : []);
    const rels = list(get("releases", []));
    section("Releases", rels.flatMap(r => [{ t: "h2", text: `${r.title || "Untitled"} (${r.type || "Single"}${r.date ? `, ${fmtDate(r.date)}` : ""})` },
      { t: "checks", items: list(r.tasks).map(t => ({ text: t.label, done: t.done })) }]));
    const samplesList = list(get("samples", []));
    section("Sample clearances", samplesList.length ? [{ t: "table", head: ["Sample", "Used", "Status", "Terms"],
      rows: samplesList.map(x => [[x.title, x.artist].filter(Boolean).join(" by "), x.used || "", x.status || "", x.terms || ""]) }] : []);

    /* ---------- Paper edits ---------- */
    const kinds = { soundbite: "Soundbite", narration: "Narration", broll: "B-roll", title: "Title", section: "Section" };
    section("Paper edits", list(get("edits", [])).flatMap(edit => [
      { t: "h2", text: edit.name || "Edit" },
      ...(list(edit.blocks).length ? [{ t: "table", head: ["#", "Kind", "Content"], rows: list(edit.blocks).map((b, i) => [
        String(i + 1), kinds[b.kind] || b.kind,
        b.kind === "soundbite" ? `${b.speakerName || "Speaker"} (${b.clipName || "clip"}, ${seconds(b.in)}–${seconds(b.out)}): “${b.text}”` : (b.text || ""),
      ]) }] : [{ t: "p", text: "Empty." }]),
    ]));

    /* ---------- Storyboards ---------- */
    section("Storyboards", list(get("storyboards", [])).flatMap(board => [
      { t: "h2", text: board.name || "Storyboard" },
      { t: "meta", text: `${board.kind === "animation" ? `Animation, ${board.fps} fps` : "Video"} · ${board.aspect} · ${plural(list(board.frames).length, "shot")}` },
      { t: "table", head: ["Shot", "Scene", "Shot / camera", "Seconds", "Action", "Dialogue & sound"],
        rows: list(board.frames).map((f, i) => [String(i + 1), f.scene || "", [f.shot, f.move].filter(Boolean).join(", "), String(f.duration ?? ""),
          f.action || "", [f.dialogue, f.sound].filter(Boolean).join("\n")]) },
    ]));

    /* ---------- Zines ---------- */
    const zines = list(get("zines", []));
    section("Zines", zines.length ? [{ t: "table", head: ["Zine", "Size", "Pages", "Critique files", "Open comments"], rows: zines.map(z => [
      z.name, `${z.size}${z.orientation === "landscape" ? ", landscape" : ""}`, String(list(z.pages).length),
      list(z.files).map(f => f.name).join("\n"),
      String(list(z.files).reduce((n, f) => n + list(f.comments).filter(c => !c.resolved).length, 0)),
    ]) }] : []);

    /* ---------- Media & transcripts ---------- */
    const media = get("media", {}) || {};
    const transcripts = list(media.transcripts);
    const clips = list(media.clips);
    section("Media & transcripts", [
      ...(transcripts.length ? [{ t: "table", head: ["Transcript", "Speakers", "Paragraphs", "Length", "Kept in"], rows: transcripts.map(t => {
        const segs = list(t.segments);
        const stored = t.storage && t.storage.where !== "project";   // words kept outside the project: use the counts saved with it
        const speakers = stored ? Object.values(t.speakers || {}) : [...new Set(segs.map(s => (t.speakers || {})[s.speaker] || s.speaker).filter(Boolean))];
        const where = !stored ? "The project" : t.storage.where === "browser" ? "Browser file storage" : `Folder “${t.storage.folder}”: ${t.storage.path}`;
        return [t.title, speakers.join(", "), String(stored ? t.paragraphs ?? "" : segs.length),
          stored ? (t.length ? seconds(t.length) : "") : segs.length ? seconds(segs[segs.length - 1].end - segs[0].start) : "",
          where + (stored && t.storage.at ? ` (moved ${fmtDate(t.storage.at)} by ${t.storage.by || "someone"})` : "")];
      }) }] : []),
      ...(clips.length ? [{ t: "p", text: `Clips: ${clips.map(c => c.name).join(", ")}` }] : []),
    ]);

    /* ---------- Datasets ---------- */
    const datasets = list(get("datasets", []));
    section("Datasets", datasets.length ? [{ t: "list", items: datasets.map(d => `${d.name} (added ${fmtDate(d.added)})`) }] : []);

    /* ---------- Resources ---------- */
    const resources = list(get("resources", []));
    section("Resources", resources.length ? [{ t: "table", head: ["Name", "Description", "Link"],
      rows: resources.map(r => [r.name || "", r.description || "", r.link || ""]) }] : []);

    /* ---------- Comments ---------- */
    const comments = get("comments", {}) || {};
    section("Comments", Object.entries(comments).flatMap(([page, threads]) => list(threads).length ? [
      { t: "h2", text: page.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) },
      { t: "list", items: list(threads).map(c => [
        `${c.author || "Anonymous"} (${fmtDate(c.created)})${c.resolved ? " [resolved]" : ""}: ${c.quote ? `“${c.quote}” ` : ""}${c.text}`,
        ...list(c.replies).map(r => `   ↳ ${r.author || "Anonymous"}: ${r.text}`),
      ].join("\n")) },
    ] : []));

    if (out.length === 2) out.push({ t: "p", text: "Nothing has been added to this project yet." });
    return out;
  }

  window.ProjectReport = {
    blocks,
    pdf(projectId) {
      const name = Projects.info().find(p => p.id === projectId)?.name || "Project";
      DocExport.print(blocks(projectId), { title: `${name} – project details` });
    },
    docx(projectId) {
      const name = Projects.info().find(p => p.id === projectId)?.name || "Project";
      DocExport.downloadDocx(blocks(projectId), { title: name, filename: `${slug(name)}-details.docx` });
    },
  };
})();
