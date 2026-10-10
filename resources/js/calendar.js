/* =========================================================
   calendar.js — the Calendar page
   ---------------------------------------------------------
   Gathers every date entered across a project into one list
   (or a month grid):
     Project Tracker  target completion, began, target publication,
                      finished, published
     Interviews       shoot (with time and place), release form date
     Pitches          the date a pitch was sent to each outlet
     Tasks            due dates of tasks on the Team page (not done)
     Writing          draft deadlines, embargoes, records-request deadlines
     Music            gigs, and release-plan steps (not done)
     Your events      added on this page; saved as
                      project.data.calendarEvents = [{ id, title, date, time, notes }]

   Dates belong where they were entered, so most entries link back
   to their page to be changed. "All projects" shows every project
   that isn't archived.

   Export: a calendar file (.ics) for Apple/Google/Outlook, or the
   list as a PDF through the browser's print window.
   "Shared calendar…" makes one .ics for everyone you work with:
   always the same file name, so it can live in a shared folder and
   be replaced as dates change. Calendar apps that subscribe to its
   link pick up the changes; every event keeps the same ID, so
   re-importing updates events instead of doubling them.

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("calendar.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);

  /* Where dates come from (colour = a small key next to each entry) */
  const SOURCES = {
    tracker:    { name: "Project Tracker", page: "project-tracker.html" },
    interviews: { name: "Interviews",      page: "interviews.html" },
    pitches:    { name: "Pitches",         page: "pitches.html" },
    tasks:      { name: "Tasks",           page: "team.html#tasks" },
    writing:    { name: "Writing",         page: "writing.html" },
    music:      { name: "Music",           page: "music.html" },
    events:     { name: "Your events",     page: null },
  };

  const TRACKER_DATES = {
    beganOn: "Began",
    targetCompletion: "Target completion",
    targetPublication: "Target publication",
    finishedOn: "Finished",
    publishedOn: "Published",
  };


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const pad = Cobbler.pad;
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayISO = () => toISO(new Date());
  const newId = () => Cobbler.newId("v");

  const fmtDay = (iso) => fromISO(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const fmtMonth = (iso) => fromISO(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  function fmtTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  const download = Cobbler.download;


  /* =========================================================
     GATHERING DATES
     Each entry: { uid, date, time, title, detail, source, href, projectId, projectName, event }
     ========================================================= */

  function datesFor(projectId, projectName) {
    const get = (key, fallback) => { const v = Projects.getDataFor(projectId, key, fallback); return v ?? fallback; };
    const out = [];
    const add = (entry) => { if (ISO.test(entry.date || "")) out.push({ projectId, projectName, time: "", detail: "", ...entry }); };

    // Project Tracker milestones
    const tracker = get("tracker", {}) || {};
    for (const [key, label] of Object.entries(TRACKER_DATES)) {
      add({ uid: `tracker-${projectId}-${key}`, date: tracker[key], title: `${label}: ${projectName}`, source: "tracker" });
    }

    // Interviews: shoots and release forms
    const people = Array.isArray(get("interviewees", [])) ? get("interviewees", []) : [];
    people.forEach(p => {
      add({ uid: `shoot-${p.id}`, date: p.shootDate, time: p.shootTime || "", title: `Interview: ${p.name || "Unnamed"}`,
            detail: [p.location, p.role].filter(Boolean).join(" · "), source: "interviews" });
      if (p.release?.date) {
        add({ uid: `release-${p.id}`, date: p.release.date, title: `Release form ${(p.release.status || "").toLowerCase()}: ${p.name || "Unnamed"}`,
              detail: p.release.notes || "", source: "interviews" });
      }
    });

    // Pitches sent
    const pitches = Array.isArray(get("pitches", [])) ? get("pitches", []) : [];
    pitches.forEach(pitch => (pitch.outlets || []).forEach(o => {
      add({ uid: `pitch-${pitch.id}-${o.id}`, date: o.sentOn, title: `Pitch sent: ${pitch.title || "Untitled"} → ${o.name || "outlet"}`,
            detail: [o.editor, o.status].filter(Boolean).join(" · "), source: "pitches" });
    }));

    // Tasks due (Team page)
    const tasks = Array.isArray(get("tasks", [])) ? get("tasks", []) : [];
    tasks.filter(t => !t.done && t.text?.trim()).forEach(t => add({
      uid: `task-${t.id}`, date: t.due, title: `Due: ${t.text.trim()}${t.assignee ? ` (${t.assignee})` : ""}`,
      detail: t.assignee ? `Assigned to ${t.assignee}` : "Unassigned", source: "tasks", assignee: t.assignee || "" }));

    // Writing: deadlines, embargoes, records requests
    const list = (key) => { const v = get(key, []); return Array.isArray(v) ? v : []; };
    list("drafts").forEach(d => {
      add({ uid: `draft-deadline-${d.id}`, date: d.deadline, title: `Deadline: ${d.title || "Untitled draft"}`, source: "writing" });
      if (d.embargo) add({ uid: `draft-embargo-${d.id}`, date: String(d.embargo).slice(0, 10), time: String(d.embargo).slice(11, 16),
        title: `Embargo lifts: ${d.title || "Untitled draft"}`, source: "writing" });
    });
    const business = (iso, days, skipWeekends) => {
      const [y, m, dd] = iso.split("-").map(Number);
      const date = new Date(y, m - 1, dd);
      let left = days;
      while (left > 0) { date.setDate(date.getDate() + 1); if (!skipWeekends || (date.getDay() % 6 !== 0)) left--; }
      return toISO(date);
    };
    const LAW_DAYS = { foia: [20, true], state: [10, true], ukfoi: [20, true], atip: [30, false], other: [30, false] };
    list("recordsRequests").filter(r => !["Fulfilled", "Denied", "Withdrawn", "Drafting"].includes(r.status)).forEach(r => {
      const [days, skip] = LAW_DAYS[r.law] || [20, true];
      const due = r.due || (ISO.test(r.sent || "") ? business(r.sent, Number(r.days) || days, skip) : "");
      add({ uid: `records-${r.id}`, date: due, title: `Records request due: ${r.agency || "agency"}`, detail: r.description || "", source: "writing" });
    });

    // Music: gigs and release plans
    list("gigs").filter(g => g.status !== "Cancelled").forEach(g => add({
      uid: `gig-${g.id}`, date: g.date, time: g.setTime || g.loadIn || "", title: `Gig: ${g.venue || "venue"}${g.city ? ` (${g.city})` : ""}`,
      detail: [g.status, g.loadIn && `load-in ${g.loadIn}`, g.setTime && `set ${g.setTime}`].filter(Boolean).join(" · "), source: "music" }));
    list("releases").filter(r => ISO.test(r.date || "")).forEach(r => {
      add({ uid: `release-${r.id}`, date: r.date, title: `Release day: ${r.title || "untitled"}`, source: "music" });
      (Array.isArray(r.tasks) ? r.tasks : []).filter(t => !t.done && t.offset !== 0).forEach(t => {
        const d = fromISO(r.date);
        d.setDate(d.getDate() + Number(t.offset || 0));
        add({ uid: `release-${r.id}-${t.id}`, date: toISO(d), title: `${r.title || "Release"}: ${t.label}`, source: "music" });
      });
    });

    // Your own events
    const events = Array.isArray(get("calendarEvents", [])) ? get("calendarEvents", []) : [];
    events.forEach(e => add({ uid: `event-${e.id}`, date: e.date, time: e.time || "", title: e.title || "Event", detail: e.notes || "", source: "events", event: e }));

    return out;
  }

  /* Every entry for the chosen projects, in date order */
  function allDates({ everySource = false } = {}) {
    const projects = view.scope === "all"
      ? Projects.list().filter(p => !p.archived || p.id === Projects.activeId())
      : Projects.list().filter(p => p.id === Projects.activeId());
    return projects.flatMap(p => datesFor(p.id, p.name))
      .filter(e => everySource || view.sources.has(e.source))
      .sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")) || a.title.localeCompare(b.title));
  }


  /* =========================================================
     VIEW STATE
     ========================================================= */

  const VIEW_KEY = "calendarView";
  const view = (() => {
    const fallback = { mode: "list", scope: "this", past: false, sources: Object.keys(SOURCES) };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch {}
    const v = { ...fallback, ...saved };
    v.sources = new Set(Array.isArray(v.sources) ? v.sources : fallback.sources);
    // Sources added since the view was saved start switched on
    const known = Array.isArray(saved.known) ? saved.known : ["tracker", "interviews", "pitches", "events"];
    Object.keys(SOURCES).filter(k => !known.includes(k)).forEach(k => v.sources.add(k));
    v.month = todayISO().slice(0, 7);   // month shown in the grid, "2026-10"
    return v;
  })();
  const saveView = () => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ mode: view.mode, scope: view.scope, past: view.past, sources: [...view.sources], known: Object.keys(SOURCES) })); } catch {}
  };


  /* =========================================================
     DRAWING
     ========================================================= */

  function render() {
    document.querySelectorAll(".view-toggle [data-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === view.mode)));
    $("cal-scope").value = view.scope;
    $("cal-past").checked = view.past;
    $("cal-past").closest("label").hidden = view.mode !== "list";

    // Source filter, with counts
    const everything = allDates({ everySource: true });
    $("cal-sources").replaceChildren(...Object.entries(SOURCES).map(([id, s]) => {
      const n = everything.filter(e => e.source === id).length;
      return el("button", {
        type: "button", class: `team-chip team-chip--toggle cal-chip is-${id}`, "aria-pressed": String(view.sources.has(id)),
        onclick: () => { view.sources.has(id) ? view.sources.delete(id) : view.sources.add(id); saveView(); render(); },
      }, `${s.name} (${n})`);
    }));

    const entries = allDates();
    $("cal-ics").disabled = !entries.length;
    $("cal-pdf").disabled = !entries.length;
    if (view.mode === "month") renderMonth(entries); else renderList(entries);
  }

  /* One entry, used by the list and the PDF */
  function entryRow(e, { links = true } = {}) {
    const source = SOURCES[e.source];
    const title = e.event && links
      ? el("button", { type: "button", class: "comment-action cal-title", onclick: () => openEvent(e.event) }, e.title)
      : el("span", { class: "cal-title" }, e.title);
    return el("li", { class: `cal-entry is-${e.source}${e.date === todayISO() ? " is-today" : ""}${e.date < todayISO() ? " is-past" : ""}` },
      el("span", { class: "cal-date" }, fmtDay(e.date)),
      el("span", { class: "cal-time" }, fmtTime(e.time) || "All day"),
      el("span", { class: "cal-what" },
        title,
        e.detail && el("span", { class: "cal-detail" }, e.detail)),
      el("span", { class: "cal-source" },
        el("span", { class: "cal-key", "aria-hidden": "true" }),
        links && source.page ? el("a", { href: source.page }, source.name) : source.name,
        view.scope === "all" && e.source !== "tracker" && el("span", { class: "cal-project" }, ` · ${e.projectName}`)));
  }

  function renderList(entries) {
    const today = todayISO();
    const shown = view.past ? entries : entries.filter(e => e.date >= today);
    const hiddenPast = entries.length - shown.length;
    const box = $("cal-body");

    if (!entries.length) {
      box.replaceChildren(el("p", { class: "media-empty" },
        "No dates yet. They appear here when you enter them in the Project Tracker, Interviews or Pitches, or add an event."));
      return;
    }

    // Grouped by month
    const groups = new Map();
    shown.forEach(e => {
      const key = e.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    box.replaceChildren(...[
      ...[...groups.entries()].map(([month, list]) => el("section", { class: "cal-month-group" },
        el("h2", { class: "iv-h2" }, fmtMonth(month + "-01")),
        el("ol", { class: "cal-list" }, list.map(e => entryRow(e))))),
      shown.length === 0 && el("p", { class: "media-empty" }, "Nothing coming up."),
      hiddenPast > 0 && el("p", { class: "media-muted" }, `${hiddenPast} past date${hiddenPast === 1 ? "" : "s"} hidden. Tick “Show past dates” to see them.`),
    ].filter(Boolean));
  }

  /* A month grid, Monday first */
  function renderMonth(entries) {
    const [y, m] = view.month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
    const byDay = new Map();
    entries.forEach(e => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });

    const weekdays = Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "short" }));   // 1 Jan 2024 was a Monday
    const cells = Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = toISO(d);
      const list = byDay.get(iso) || [];
      return el("div", { class: `cal-cell${d.getMonth() !== m - 1 ? " is-other-month" : ""}${iso === todayISO() ? " is-today" : ""}` },
        el("span", { class: "cal-cell-day" }, String(d.getDate())),
        list.slice(0, 4).map(e => el(e.event ? "button" : "a", {
          class: `cal-pill is-${e.source}`, title: `${e.title}${e.time ? ` · ${fmtTime(e.time)}` : ""}`,
          href: e.event ? null : SOURCES[e.source].page,
          type: e.event ? "button" : null,
          onclick: e.event ? () => openEvent(e.event) : null,
        }, (e.time ? fmtTime(e.time) + " " : "") + e.title)),
        list.length > 4 && el("span", { class: "cal-more" }, `+${list.length - 4} more`));
    });

    const shift = (delta) => {
      const d = new Date(y, m - 1 + delta, 1);
      view.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      render();
    };
    $("cal-body").replaceChildren(
      el("div", { class: "cal-month-bar" },
        el("button", { type: "button", class: "small-btn", "aria-label": "Previous month", onclick: () => shift(-1) }, "‹"),
        el("h2", { class: "iv-h2" }, fmtMonth(view.month + "-01")),
        el("button", { type: "button", class: "small-btn", "aria-label": "Next month", onclick: () => shift(1) }, "›"),
        el("button", { type: "button", class: "small-btn", onclick: () => { view.month = todayISO().slice(0, 7); render(); } }, "Today")),
      el("div", { class: "cal-grid" },
        weekdays.map(w => el("span", { class: "cal-weekday" }, w)),
        cells));
  }


  /* =========================================================
     YOUR OWN EVENTS
     ========================================================= */

  let editing = null;

  function openEvent(event = null) {
    editing = event;
    const form = $("cal-form");
    form.reset();
    form.elements.title.value = event?.title || "";
    form.elements.date.value = event?.date || (view.mode === "month" ? `${view.month}-01` : todayISO());
    form.elements.time.value = event?.time || "";
    form.elements.notes.value = event?.notes || "";
    $("cal-dialog-title").textContent = event ? "Edit event" : "Add event";
    $("cal-delete").hidden = !event;
    $("cal-dialog").showModal();
    form.elements.title.focus();
  }

  function saveEvents(update) {
    const events = Projects.getData("calendarEvents", []);
    const list = Array.isArray(events) ? events : [];
    update(list);
    Projects.setData("calendarEvents", list);
  }


  /* =========================================================
     EXPORT
     ========================================================= */

  /* Long lines are folded at 75 bytes, as calendar files require */
  function fold(line) {
    const out = [];
    let rest = line;
    while (new TextEncoder().encode(rest).length > 74) {
      let n = 73;
      while (new TextEncoder().encode(rest.slice(0, n)).length > 73) n--;
      if (/[\uD800-\uDBFF]/.test(rest[n - 1])) n--;   // don't split an emoji in two
      out.push(rest.slice(0, n));
      rest = " " + rest.slice(n);
    }
    out.push(rest);
    return out.join("\r\n");
  }

  /* A calendar file: timed entries last an hour, others are all-day.
     `shared` adds a calendar name and asks subscribed apps to check for changes hourly. */
  function toICS(entries, shared = null) {
    const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const events = entries.map(e => {
      const day = e.date.replace(/-/g, "");
      let when;
      if (e.time) {
        const [h, m] = e.time.split(":").map(Number);
        when = [`DTSTART:${day}T${pad(h)}${pad(m)}00`, `DTEND:${day}T${h >= 23 ? "235900" : `${pad(h + 1)}${pad(m)}00`}`];
      } else {
        const next = fromISO(e.date);
        next.setDate(next.getDate() + 1);
        when = [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${toISO(next).replace(/-/g, "")}`];
      }
      const description = [e.detail, `From ${SOURCES[e.source].name}${view.scope === "all" ? ` (${e.projectName})` : ""}`].filter(Boolean).join("\n");
      return ["BEGIN:VEVENT", `UID:${e.uid}@cobbler-project`, `DTSTAMP:${stamp}`, `LAST-MODIFIED:${stamp}`, ...when,
        `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(description)}`, "END:VEVENT"].map(fold).join("\r\n");
    });
    const head = shared ? ["METHOD:PUBLISH", `X-WR-CALNAME:${esc(shared.name)}`, `NAME:${esc(shared.name)}`,
      "X-WR-CALDESC:Dates from The Cobbler Project", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"].map(fold) : [];
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Cobbler Project//Calendar//EN", "CALSCALE:GREGORIAN",
            ...head, ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
  }

  /* ---------- Shared calendar ---------- */

  function setUpShared() {
    const dialog = $("cal-share-dialog");
    const form = $("cal-share-form");
    const projectsFor = (scope) => scope === "all"
      ? Projects.list().filter(p => !p.archived || p.id === Projects.activeId())
      : Projects.list().filter(p => p.id === Projects.activeId());

    const update = () => {
      const scope = form.elements.scope.value;
      const sources = new Set([...form.querySelectorAll("[name=source]:checked")].map(b => b.value));
      const person = form.elements.person.value;
      const entries = projectsFor(scope).flatMap(p => datesFor(p.id, p.name))
        .filter(e => sources.has(e.source))
        .filter(e => e.source !== "tasks" || !person || (e.assignee || "").toLowerCase() === person.toLowerCase());
      $("cal-share-count").textContent = `${entries.length} date${entries.length === 1 ? "" : "s"} will go in the file.`;
      return entries;
    };

    $("cal-share").addEventListener("click", () => {
      form.reset();
      form.elements.name.value = `${Projects.activeName()} (Cobbler)`;
      $("cal-share-sources").replaceChildren(...Object.entries(SOURCES).map(([id, src]) =>
        el("label", { class: "team-chip team-chip--toggle cal-share-source" },
          el("input", { type: "checkbox", name: "source", value: id, checked: true }), src.name)));
      const team = Projects.getData("team", []);
      $("cal-share-person").replaceChildren(el("option", { value: "" }, "Everyone's tasks"),
        ...(Array.isArray(team) ? team : []).filter(m => m.name).map(m => el("option", { value: m.name }, `Only ${m.name}'s tasks`)));
      update();
      dialog.showModal();
    });
    form.addEventListener("change", update);
    form.elements.scope.addEventListener("change", () => {
      form.elements.name.value = form.elements.scope.value === "all" ? "All projects (Cobbler)" : `${Projects.activeName()} (Cobbler)`;
    });
    $("cal-share-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = form.elements.name.value.trim() || "Cobbler calendar";
      const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cobbler"}-shared.ics`;
      download(toICS(update(), { name }), file, "text/calendar");
      $("cal-share-count").textContent = `Downloaded ${file}. Replace the old copy in your shared folder with it.`;
    });
  }

  /* The list as a PDF, through the print window */
  function savePDF() {
    const entries = allDates().filter(e => view.past || e.date >= todayISO());
    const title = view.scope === "all" ? "All projects" : Projects.activeName();
    $("cal-print").replaceChildren(
      el("header", { class: "cal-print-head" },
        el("h1", {}, `Calendar: ${title}`),
        el("p", {}, `${entries.length} date${entries.length === 1 ? "" : "s"}${view.past ? "" : " from today on"} · printed ${fmtDay(todayISO())}`)),
      el("table", { class: "cal-print-table" },
        el("thead", {}, el("tr", {}, ["Date", "Time", "What", "From"].map(h => el("th", {}, h)))),
        el("tbody", {}, entries.map(e => el("tr", {},
          el("td", {}, fmtDay(e.date)),
          el("td", {}, fmtTime(e.time) || "All day"),
          el("td", {}, e.title, e.detail && el("div", { class: "cal-print-detail" }, e.detail)),
          el("td", {}, SOURCES[e.source].name + (view.scope === "all" ? ` (${e.projectName})` : "")))))));
    const pageTitle = document.title;
    document.title = `Calendar – ${title}`;
    requestAnimationFrame(() => requestAnimationFrame(() => { window.print(); document.title = pageTitle; }));
  }
  window.addEventListener("afterprint", () => $("cal-print").replaceChildren());


  /* =========================================================
     START-UP
     ========================================================= */

  // Other pages (the Home dashboard) can gather dates too
  window.CobblerCalendar = { datesFor, SOURCES };

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("cal-body")) return;   // loaded on another page just for its dates
    document.querySelectorAll(".view-toggle [data-view]").forEach(b =>
      b.addEventListener("click", () => { view.mode = b.dataset.view; saveView(); render(); }));
    $("cal-scope").addEventListener("change", (event) => { view.scope = event.target.value; saveView(); render(); });
    $("cal-past").addEventListener("change", (event) => { view.past = event.target.checked; saveView(); render(); });
    $("cal-ics").addEventListener("click", () => {
      const slug = (view.scope === "all" ? "all-projects" : Projects.activeName()).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      download(toICS(allDates()), `${slug || "project"}-calendar.ics`, "text/calendar");
    });
    $("cal-pdf").addEventListener("click", savePDF);
    setUpShared();

    // Your events
    const dialog = $("cal-dialog");
    $("cal-add").addEventListener("click", () => openEvent());
    $("cal-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    $("cal-delete").addEventListener("click", () => {
      if (!editing || !confirm(`Delete “${editing.title}”?`)) return;
      saveEvents(list => { const i = list.findIndex(e => e.id === editing.id); if (i >= 0) list.splice(i, 1); });
      dialog.close();
      render();
    });
    $("cal-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const fields = {
        title: String(data.get("title")).trim(), date: String(data.get("date")),
        time: String(data.get("time") || ""), notes: String(data.get("notes") || "").trim(),
      };
      saveEvents(list => {
        const existing = editing && list.find(e => e.id === editing.id);
        if (existing) Object.assign(existing, fields);
        else list.push({ id: newId(), ...fields });
      });
      // Show the month the event is in
      view.month = fields.date.slice(0, 7);
      dialog.close();
      render();
    });

    render();
  });
})();
