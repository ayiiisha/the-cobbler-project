/* =========================================================
   writing-reporting.js — the Reporting tab of the Writing page
   ---------------------------------------------------------
   For nonfiction and journalism (saved in the project, shared
   by every draft):
   • Sources: who they are, how they can be quoted (on the
     record, background, anonymous…), what was agreed, why
     anonymity was granted and who approved it, and a log of
     every contact.
       project.data.sourceLog = [{ id, name, role, contact, attribution, agreement,
                                   anonymity, approvedBy, notes, log: [{ id, date, method, note }] }]
   • Records requests (FOIA and others), with the legal response
     deadline worked out (business days skip weekends) and shown
     on the Calendar.
       project.data.recordsRequests = [{ id, agency, law, description, sent, days,
                                         due, status, tracking, contact, notes }]
   • Event timeline: what happened when, with sources and how
     sure you are. Export as a table (PDF, .docx or CSV).
       project.data.eventTimeline = [{ id, date, time, title, detail, source, confirmed }]

   Needs writing-core.js (doc-export.js for the timeline export).
   ========================================================= */
(() => {

  const W = window.WritingPage;
  if (!W) return;
  const { el, newId } = W;

  const ATTRIBUTION = ["On the record", "On background", "Deep background", "Off the record", "Anonymous", "Not agreed yet"];
  const METHODS = ["Email", "Phone call", "Text message", "In person", "Video call", "Social media", "Letter", "Other"];
  const LAWS = {
    foia:  { name: "FOIA (US federal)", days: 20, business: true },
    state: { name: "State public records law", days: 10, business: true },
    ukfoi: { name: "Freedom of Information Act (UK)", days: 20, business: true },
    atip:  { name: "Access to Information (Canada)", days: 30, business: false },
    other: { name: "Other", days: 30, business: false },
  };
  const REQ_STATUSES = ["Drafting", "Sent", "Acknowledged", "Extended", "Partly released", "Fulfilled", "Denied", "Appealed", "Withdrawn"];

  function render(panel) {
    panel.replaceChildren(
      el("p", { class: "media-tip" }, "Reporting tools for the whole project: sources and what you agreed with them, records requests and their deadlines, and a timeline of events."),
      sourcesSection(panel), requestsSection(panel), timelineSection(panel));
  }

  // A text field bound to obj[key]
  function bound(obj, key, label, save, { textarea = false, rows = 2, type = "text", placeholder = "" } = {}) {
    const input = textarea ? el("textarea", { rows: String(rows), placeholder, "aria-label": label }) : el("input", { type, placeholder, "aria-label": label });
    input.value = obj[key] ?? "";
    input.addEventListener(type === "date" ? "change" : "input", () => { obj[key] = input.value; save(); });
    return el("label", { class: "wr-field" }, label, input);
  }
  function choice(obj, key, label, options, save, onChange) {
    const select = el("select", { class: "team-select", "aria-label": label }, options.map(([v, t]) => el("option", { value: v }, t)));
    select.value = obj[key] ?? options[0][0];
    select.addEventListener("change", () => { obj[key] = select.value; save(); onChange?.(); });
    return el("label", { class: "wr-field" }, label, select);
  }


  /* =========================================================
     SOURCES
     ========================================================= */

  let sourceFilter = "";
  const transcripts = () => window.MediaCore ? MediaCore.loadMedia().transcripts : [];
  // Transcripts whose name or speakers mention the person (e.g. "Interview_Maria")
  function guessTranscripts(name) {
    const parts = String(name || "").toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    if (!parts.length) return [];
    return transcripts().filter(t => {
      const hay = [t.title, t.file, ...Object.values(t.speakers || {})].join(" ").toLowerCase();
      return parts.some(w => hay.includes(w));
    }).map(t => t.id);
  }
  function sourcesSection(panel) {
    const sources = W.list("sourceLog");
    const save = () => W.saveList("sourceLog", sources);
    const shown = sources.filter(s => !sourceFilter || s.attribution === sourceFilter);
    const people = (() => { const v = Projects.getData("interviewees", []); return Array.isArray(v) ? v : []; })();
    const missing = people.filter(p => p.name && !sources.some(s => s.name.trim().toLowerCase() === p.name.trim().toLowerCase()));

    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" },
        el("h2", {}, "Sources"),
        el("span", { class: "comment-actions" },
          missing.length > 0 && el("button", { type: "button", class: "small-btn", onclick: () => {
            missing.forEach(p => sources.push({ id: newId("so"), name: p.name, role: p.role || "", contact: p.contact || p.email || "", attribution: "Not agreed yet", agreement: "", anonymity: "", approvedBy: "", notes: "", log: [], interviewId: p.id, transcriptIds: guessTranscripts(p.name) }));
            save(); render(panel);
          } }, `+ ${missing.length} from Interviews`),
          el("button", { type: "button", class: "small-btn", onclick: () => {
            sources.push({ id: newId("so"), name: "", role: "", contact: "", attribution: "Not agreed yet", agreement: "", anonymity: "", approvedBy: "", notes: "", log: [] });
            save(); render(panel);
          } }, "+ Source"))),
      el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "Show" },
        ["", ...ATTRIBUTION].map(a => el("button", { type: "button", "aria-pressed": String(sourceFilter === a), onclick: () => { sourceFilter = a; render(panel); } },
          `${a || "All"} (${sources.filter(s => !a || s.attribution === a).length})`))),
      shown.length ? el("div", { class: "research-grid" }, shown.map(s => {
        s.log = Array.isArray(s.log) ? s.log : [];
        const anon = ["Anonymous", "Off the record", "Deep background"].includes(s.attribution);
        const logList = el("ol", { class: "wr-log" }, [...s.log].sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(entry => el("li", {},
          el("span", { class: "wr-when" }, W.fmtDate(entry.date)), el("strong", {}, entry.method), entry.note && ` · ${entry.note}`,
          el("button", { type: "button", class: "goal-item-remove", "aria-label": "Remove", onclick: () => { s.log.splice(s.log.indexOf(entry), 1); save(); render(panel); } }, "×"))));
        const method = el("select", { class: "team-select", "aria-label": "How" }, METHODS.map(m => el("option", { value: m }, m)));
        const when = el("input", { type: "date", value: W.todayISO(), "aria-label": "When" });
        const note = el("input", { placeholder: "What happened (left a message, agreed to talk…)", "aria-label": "Note" });
        const add = () => { s.log.push({ id: newId("lg"), date: when.value, method: method.value, note: note.value.trim() }); save(); render(panel); };
        note.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); add(); } });
        return el("article", { class: `research-card wr-source is-${anon ? "anon" : "record"}` },
          el("div", { class: "research-card-head" },
            el("input", { class: "wr-bible-name", value: s.name, placeholder: "Name", "aria-label": "Name", oninput: (e) => { s.name = e.target.value; save(); } }),
            el("span", { class: "pitch-pill" }, s.attribution)),
          bound(s, "role", "Who they are", save, { placeholder: "Job, relationship to the story" }),
          bound(s, "contact", "Contact", save),
          choice(s, "attribution", "How they can be quoted", ATTRIBUTION.map(a => [a, a]), save, () => render(panel)),
          bound(s, "agreement", "What was agreed (and when)", save, { textarea: true }),
          anon && bound(s, "anonymity", "Why anonymity: the risk to them, why they know", save, { textarea: true }),
          anon && bound(s, "approvedBy", "Approved by (editor)", save),
          el("div", { class: "wr-field" }, `Contact log (${s.log.length})`, logList,
            el("div", { class: "wr-log-add" }, when, method, note, el("button", { type: "button", class: "small-btn", onclick: add }, "Add"))),
          linkFields(s, people, save, () => render(panel)),
          bound(s, "notes", "Notes", save, { textarea: true }),
          el("div", { class: "comment-actions" }, el("button", { type: "button", class: "comment-action", onclick: () => {
            if (!confirm(`Delete ${s.name || "this source"} and their contact log?`)) return;
            sources.splice(sources.indexOf(s), 1); save(); render(panel);
          } }, "Delete")));
      })) : el("p", { class: "media-empty" }, sources.length ? "No sources with that agreement." : "Track each source: how they can be quoted, what you agreed, and every time you were in touch."));
  }


  /* Links a source to their Interviews entry and to the transcripts of what they said
     (the quote checker uses these to check who said what) */
  function linkFields(s, people, save, redraw) {
    s.transcriptIds = Array.isArray(s.transcriptIds) ? s.transcriptIds : [];
    const who = el("select", { class: "team-select", "aria-label": "Their interview" },
      el("option", { value: "" }, people.length ? "Not on the Interviews page" : "No one on the Interviews page"),
      people.map(p => el("option", { value: p.id }, p.name || "Unnamed")));
    who.value = s.interviewId || "";
    who.addEventListener("change", () => { s.interviewId = who.value; save(); });
    const all = transcripts();
    return el("div", { class: "wr-field" }, "Their interview and transcripts", who,
      all.length
        ? el("div", { class: "team-chips" }, all.map(t => el("button", { type: "button", class: "team-chip team-chip--toggle", "aria-pressed": String(s.transcriptIds.includes(t.id)),
            onclick: () => { s.transcriptIds = s.transcriptIds.includes(t.id) ? s.transcriptIds.filter(x => x !== t.id) : [...s.transcriptIds, t.id]; save(); redraw(); } }, t.title)))
        : el("span", { class: "media-muted" }, "No transcripts yet (Media & Transcripts)."),
      s.transcriptIds.length > 0 && el("span", { class: "media-muted" }, "The quote checker checks quotes attributed to them against these."));
  }

  /* =========================================================
     RECORDS REQUESTS
     ========================================================= */

  function addDays(iso, days, business) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    let left = days;
    while (left > 0) {
      date.setDate(date.getDate() + 1);
      if (!business || (date.getDay() !== 0 && date.getDay() !== 6)) left--;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  const dueOf = (r) => r.due || addDays(r.sent, Number(r.days) || LAWS[r.law]?.days || 20, LAWS[r.law]?.business ?? true);
  W.recordsDue = dueOf;

  function requestsSection(panel) {
    const reqs = W.list("recordsRequests");
    const save = () => W.saveList("recordsRequests", reqs);
    const today = W.todayISO();
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" },
        el("h2", {}, "Records requests"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          reqs.push({ id: newId("rq"), agency: "", law: "foia", description: "", sent: "", days: "", due: "", status: "Drafting", tracking: "", contact: "", notes: "" });
          save(); render(panel);
        } }, "+ Request")),
      el("p", { class: "media-tip" }, "The response deadline is worked out from the date sent (business days skip weekends, not public holidays: check the law that applies). Deadlines show on the Calendar."),
      reqs.length ? el("div", { class: "research-grid" }, reqs.map(r => {
        const due = dueOf(r);
        const open = !["Fulfilled", "Denied", "Withdrawn"].includes(r.status);
        const late = open && r.status !== "Drafting" && due && due < today;
        const redraw = () => render(panel);
        return el("article", { class: `research-card wr-request${late ? " is-late" : ""}` },
          el("div", { class: "research-card-head" },
            el("input", { class: "wr-bible-name", value: r.agency, placeholder: "Agency", "aria-label": "Agency", oninput: (e) => { r.agency = e.target.value; save(); } }),
            el("span", { class: "pitch-pill" }, r.status)),
          bound(r, "description", "What you asked for", save, { textarea: true }),
          el("div", { class: "zine-form-row" },
            choice(r, "law", "Law", Object.entries(LAWS).map(([k, v]) => [k, v.name]), save, redraw),
            choice(r, "status", "Status", REQ_STATUSES.map(s => [s, s]), save, redraw)),
          el("div", { class: "zine-form-row" },
            bound(r, "sent", "Sent", () => { save(); redraw(); }, { type: "date" }),
            bound(r, "days", `Days to respond (default ${LAWS[r.law]?.days ?? 20})`, () => { save(); redraw(); }, { type: "number" }),
            bound(r, "due", "Due (override)", () => { save(); redraw(); }, { type: "date" })),
          el("p", { class: late ? "wr-thread-flag" : "media-muted" }, due ? `${late ? "Overdue since" : "Response due"} ${W.fmtDate(due)}` : "Add the date sent to see the deadline."),
          el("div", { class: "zine-form-row" }, bound(r, "tracking", "Tracking number", save), bound(r, "contact", "Records officer", save)),
          bound(r, "notes", "Notes (calls, extensions, appeals)", save, { textarea: true }),
          el("div", { class: "comment-actions" }, el("button", { type: "button", class: "comment-action", onclick: () => {
            if (!confirm("Delete this request?")) return;
            reqs.splice(reqs.indexOf(r), 1); save(); render(panel);
          } }, "Delete")));
      })) : el("p", { class: "media-empty" }, "No requests yet."));
  }


  /* =========================================================
     EVENT TIMELINE
     ========================================================= */

  function timelineSection(panel) {
    const events = W.list("eventTimeline");
    const save = () => W.saveList("eventTimeline", events);
    const sorted = [...events].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.time || "").localeCompare(b.time || ""));
    const exportBlocks = () => [
      { t: "title", text: `Timeline: ${Projects.activeName()}` },
      { t: "table", head: ["Date", "What happened", "Source", "Confirmed"],
        rows: sorted.map(e => [`${e.date || ""}${e.time ? ` ${e.time}` : ""}`, [e.title, e.detail].filter(Boolean).join("\n"), e.source || "", e.confirmed ? "Yes" : "No"]) }];
    const csv = () => {
      const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      return ["Date,Time,Event,Detail,Source,Confirmed", ...sorted.map(e => [e.date, e.time, e.title, e.detail, e.source, e.confirmed ? "Yes" : "No"].map(q).join(","))].join("\r\n");
    };
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" },
        el("h2", {}, "Event timeline"),
        el("span", { class: "comment-actions" },
          el("button", { type: "button", class: "small-btn", onclick: () => {
            events.push({ id: newId("ev"), date: "", time: "", title: "", detail: "", source: "", confirmed: false });
            save(); render(panel);
            document.querySelector(".wr-events li:last-child input")?.focus();
          } }, "+ Event"),
          events.length > 0 && el("select", { class: "team-select", "aria-label": "Export timeline", onchange: (e) => {
            const v = e.target.value; e.target.value = "";
            if (v === "pdf") DocExport.print(exportBlocks(), { title: `Timeline – ${Projects.activeName()}` });
            if (v === "docx") DocExport.downloadDocx(exportBlocks(), { title: "Timeline", filename: `${W.slug(Projects.activeName())}-timeline.docx` });
            if (v === "csv") W.download(new Blob([csv()], { type: "text/csv" }), `${W.slug(Projects.activeName())}-timeline.csv`);
          } }, el("option", { value: "" }, "Export…"), el("option", { value: "pdf" }, "PDF"), el("option", { value: "docx" }, "Word (.docx)"), el("option", { value: "csv" }, "CSV (for Datawrapper, TimelineJS)")))),
      el("p", { class: "media-tip" }, "Dates can be exact (2023-03-14), a month (2023-03) or a year (2023); they sort in order."),
      sorted.length ? el("ol", { class: "wr-events" }, sorted.map(e => {
        const f = (key, label, attrs = {}) => {
          const i = el("input", { value: e[key] || "", "aria-label": label, placeholder: label, ...attrs });
          i.addEventListener("change", () => { e[key] = i.value; save(); if (key === "date" || key === "time") render(panel); });
          return i;
        };
        const confirmed = el("input", { type: "checkbox", checked: !!e.confirmed });
        confirmed.addEventListener("change", () => { e.confirmed = confirmed.checked; save(); });
        const detail = el("textarea", { rows: "2", placeholder: "Detail", "aria-label": "Detail" });
        detail.value = e.detail || "";
        detail.addEventListener("input", () => { e.detail = detail.value; save(); });
        return el("li", { class: `wr-event${e.confirmed ? " is-confirmed" : ""}` },
          el("div", { class: "wr-event-when" }, f("date", "Date", { class: "wr-event-date" }), f("time", "Time", { class: "wr-event-time", type: "time" })),
          el("div", { class: "wr-event-what" }, f("title", "What happened"), detail, f("source", "Source (document, person, link)"),
            el("div", { class: "comment-actions" },
              el("label", { class: "credits-check" }, confirmed, " Confirmed by two sources or a document"),
              el("button", { type: "button", class: "comment-action", onclick: () => { events.splice(events.indexOf(e), 1); save(); render(panel); } }, "Delete"))));
      })) : el("p", { class: "media-empty" }, "Build the chronology of what happened, one event at a time."));
  }

  W.register("reporting", { render });
})();
