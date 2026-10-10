/* =========================================================
   project-tracker.js — the Project Tracker page
   ---------------------------------------------------------
   One row per project on the site. Each project keeps its
   own tracker details, under the key "tracker":

     project.data.tracker = {
       medium, status, inProgress, nextUp, pitchLink, team,
       targetCompletion, taxonomy, beganOn, targetPublication,
       finishedOn, publishedOn, finalLink, notes,
       goals: [{ id, name, tasks: [{ id, text, done }], people, status, barriers: ["..."] }]
     }
   Dates are saved as "2026-10-12". The Project Name column
   is the project's own name, so editing it renames the project.

   Dates can be typed in many ways: "12 Oct 2026", "Oct 12",
   "2026-10-12", "12/10/26" (in your computer's day/month order),
   "today", "tomorrow", "yesterday". Or pick one with the calendar button.

   Goals: the Goals column opens a row of goal cards under a project
   (name, sub-tasks with checkboxes, people involved, status, barriers).

   Team Members: shows the people on the project's Team page
   (team.js, saved as project.data.team). Names typed into this
   column before that existed are kept, with a button to add them
   to the team.

   Archive: hides a finished project from the tracker, the sidebar menu
   and the Projects page (until "Show archived" is ticked).

   Needs projects-core.js loaded first.
   ========================================================= */
(() => {

  /* ---------- Safety check ---------- */
  if (!window.Projects) {
    console.error("project-tracker.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);


  /* =========================================================
     SETTINGS
     ========================================================= */

  const DATA_KEY = "tracker";
  const VIEW_KEY = "trackerView";   // remembers sorting, filter and search (this browser)

  const STATUSES = ["Not Started", "Some Progress", "About Halfway", "Substantial Progress", "Done"];
  const STAGES = ["Not Started", "Planning", "Research", "Interview", "Recording",
                  "Writing", "Video Editing", "Review", "Polishing", "Done"];

  // Suggestions for the Medium column (anything can be typed)
  const MEDIA = ["Article", "Feature", "Video", "Documentary", "Short film", "Animation", "Podcast",
                 "Radio", "Photo essay", "Zine", "Newsletter", "Social video", "Music", "Book"];

  /* The columns, in order. `w` is the column's minimum width. */
  const COLUMNS = [
    { key: "name",              label: "Project Name",          type: "name",     w: "14rem" },
    { key: "medium",            label: "Medium",                type: "text",     w: "9rem", list: "tracker-media" },
    { key: "status",            label: "Status",                type: "select",   w: "12rem", options: STATUSES },
    { key: "inProgress",        label: "In Progress",           type: "select",   w: "10rem", options: STAGES },
    { key: "nextUp",            label: "Next Up",               type: "select",   w: "10rem", options: STAGES },
    { key: "goals",             label: "Goals",                 type: "goals",    w: "10rem" },
    { key: "pitchLink",         label: "Link to Pitch Doc",     type: "link",     w: "11rem" },
    { key: "team",              label: "Team Members",          type: "team",     w: "12rem" },
    { key: "targetCompletion",  label: "Target Completion",     type: "date",     w: "9.5rem" },
    { key: "taxonomy",          label: "Taxonomy",              type: "text",     w: "10rem", placeholder: "Tags, commas between" },
    { key: "beganOn",           label: "Began On",              type: "date",     w: "9.5rem" },
    { key: "targetPublication", label: "Target Publication",    type: "date",     w: "9.5rem" },
    { key: "finishedOn",        label: "Finished On",           type: "date",     w: "9.5rem" },
    { key: "publishedOn",       label: "Published On",          type: "date",     w: "9.5rem" },
    { key: "finalLink",         label: "Link to Final Product", type: "link",     w: "11rem" },
    { key: "notes",             label: "Notes",                 type: "textarea", w: "16rem" },
  ];

  // New goal cards: an empty sub-task and barrier ready to type in
  const STARTING_GOALS = 4;   // matches the template: four goals side by side

  const DEFAULTS = {
    medium: "", status: "Not Started", inProgress: "Not Started", nextUp: "Not Started",
    pitchLink: "", team: "", targetCompletion: "", taxonomy: "", beganOn: "",
    targetPublication: "", finishedOn: "", publishedOn: "", finalLink: "", notes: "",
  };


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const newId = Cobbler.newId;

  /* Only allows http, https and mailto links. Adds https:// if there's no scheme. */
  function safeUrl(value) {
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = "https://" + value;
    try {
      const url = new URL(value);
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  function loadView() {
    const fallback = { sort: "name", dir: 1, status: "", search: "", open: [], showArchived: false };
    try { return { ...fallback, ...JSON.parse(localStorage.getItem(VIEW_KEY)) }; }
    catch { return fallback; }
  }
  const view = loadView();
  const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {} };


  /* =========================================================
     DATES: reading what you type
     ========================================================= */

  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  // Does this computer write the day before the month? (12/10 = 12 October)
  const DAY_FIRST = (() => {
    const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 11, 31));
    return parts.findIndex(p => p.type === "day") < parts.findIndex(p => p.type === "month");
  })();

  const pad = Cobbler.pad;
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // "2026-10-12" → a Date at local midnight
  const fromISO = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  // "2026-10-12" → "12 Oct 2026" (in your computer's style)
  const formatDate = (iso) => iso
    ? fromISO(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "";

  // A real date, or null for things like 31 February
  function makeDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 && date.getDate() === day ? toISO(date) : null;
  }

  // "26" → 2026, missing → this year
  const fullYear = (text) => !text ? new Date().getFullYear() : text.length === 2 ? 2000 + Number(text) : Number(text);

  // "oct", "October", "sept" → 10
  const monthNumber = (word) => word.length >= 3 ? MONTHS.findIndex(m => word.startsWith(m)) + 1 : 0;

  /* Returns "2026-10-12", "" for an empty box, or null if it can't be read */
  function parseDate(input) {
    const text = input.trim().toLowerCase()
      .replace(/,/g, " ")
      .replace(/(\d)(st|nd|rd|th)\b/g, "$1")   // 12th → 12
      .replace(/\s+/g, " ");
    if (!text) return "";

    const today = new Date();
    const offsets = { today: 0, tomorrow: 1, yesterday: -1 };
    if (text in offsets) {
      today.setDate(today.getDate() + offsets[text]);
      return toISO(today);
    }

    let m;
    // 2026-10-12, 2026/10/12
    if ((m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return makeDate(+m[1], +m[2], +m[3]);

    // 12/10/2026, 12-10-26, 12.10 (day/month order follows this computer)
    if ((m = text.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/))) {
      const [day, month] = DAY_FIRST ? [+m[1], +m[2]] : [+m[2], +m[1]];
      return makeDate(fullYear(m[3]), month, day);
    }

    // 12 Oct 2026, 12 October
    if ((m = text.match(/^(\d{1,2}) ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/)) && monthNumber(m[2])) {
      return makeDate(fullYear(m[3]), monthNumber(m[2]), +m[1]);
    }

    // Oct 12 2026, October 12
    if ((m = text.match(/^([a-z]+)\.? (\d{1,2})(?: (\d{2}|\d{4}))?$/)) && monthNumber(m[1])) {
      return makeDate(fullYear(m[3]), monthNumber(m[1]), +m[2]);
    }

    // October 2026 → the 1st
    if ((m = text.match(/^([a-z]+)\.? (\d{4})$/)) && monthNumber(m[1])) {
      return makeDate(+m[2], monthNumber(m[1]), 1);
    }
    return null;
  }

  const todayISO = () => toISO(new Date());

  /* Past a target date and not finished yet? */
  function overdue(record, key) {
    const date = record[key];
    if (!date || date >= todayISO()) return false;
    if (key === "targetCompletion") return record.status !== "Done" && !record.finishedOn;
    if (key === "targetPublication") return !record.publishedOn;
    return false;
  }


  /* =========================================================
     DATA
     ========================================================= */

  /* Every project with its tracker details */
  function rows() {
    return Projects.info().map(p => {
      const saved = Projects.getDataFor(p.id, DATA_KEY, {});
      return {
        id: p.id,
        name: p.name,
        active: p.active,
        archived: p.archived,
        // Never had goals saved: start with four blank ones, like the template.
        // (Once you've removed goals, they stay removed.)
        seedGoals: !Array.isArray(saved.goals),
        team: teamOf(p.id),
        record: withGoals({ ...DEFAULTS, ...saved }),
      };
    });
  }

  // The people on a project's Team page
  function teamOf(id) {
    const team = Projects.getDataFor(id, "team", []);
    return Array.isArray(team) ? team.filter(m => m && typeof m.name === "string") : [];
  }

  // Makes sure a record has its own goals list, with every part of each goal filled in
  function withGoals(record) {
    record.goals = Array.isArray(record.goals) ? record.goals : [];
    record.goals.forEach(goal => {
      goal.id ||= newId("g");
      goal.name ??= "";
      goal.people ??= "";
      goal.status = STATUSES.includes(goal.status) ? goal.status : STATUSES[0];
      goal.tasks = Array.isArray(goal.tasks) ? goal.tasks : [];
      goal.barriers = Array.isArray(goal.barriers) ? goal.barriers : [];
    });
    return record;
  }

  // Typing saves after a short pause; picking from a menu saves right away
  const timers = new Map();
  function saveRow(row, { soon = false } = {}) {
    clearTimeout(timers.get(row.id));
    if (!soon) { timers.delete(row.id); Projects.setDataFor(row.id, DATA_KEY, row.record); return; }
    timers.set(row.id, setTimeout(() => saveRow(row), 400));
  }
  window.addEventListener("pagehide", () => {
    timers.forEach(clearTimeout);
    currentRows.forEach(row => { if (timers.has(row.id)) Projects.setDataFor(row.id, DATA_KEY, row.record); });
  });


  /* =========================================================
     SORTING AND FILTERING
     ========================================================= */

  function sortValue(row, key) {
    if (key === "name") return row.name.toLowerCase();
    if (key === "team") return row.team.map(m => m.name).join(", ").toLowerCase();
    const value = row.record[key];
    if (key === "status") return STATUSES.indexOf(value);
    if (key === "inProgress" || key === "nextUp") return STAGES.indexOf(value);
    if (key === "goals") {
      const goals = row.record.goals.filter(hasContent);
      return goals.length ? goalsDone(row.record) / goals.length : "";
    }
    return String(value || "").toLowerCase();
  }

  function visibleRows(all) {
    const words = view.search.trim().toLowerCase();
    return all
      .filter(row => view.showArchived || !row.archived)
      .filter(row => !view.status || row.record.status === view.status)
      .filter(row => !words || [row.name, row.record.medium, row.record.team, row.record.taxonomy, row.record.notes,
          ...row.team.flatMap(m => [m.name, ...(m.roles || [])]),
          ...row.record.goals.flatMap(g => [g.name, g.people, ...g.tasks.map(t => t.text), ...g.barriers])]
        .join(" ").toLowerCase().includes(words))
      .sort((a, b) => {
        const x = sortValue(a, view.sort), y = sortValue(b, view.sort);
        // empty values always go last
        if (x === "" && y !== "") return 1;
        if (y === "" && x !== "") return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * view.dir || a.name.localeCompare(b.name);
      });
  }


  /* =========================================================
     CELLS
     ========================================================= */

  function cell(row, column) {
    const { key, type } = column;
    const record = row.record;
    const td = el(key === "name" ? "th" : "td", { dataset: { key }, scope: key === "name" ? "row" : null });
    td.style.setProperty("--w", column.w);
    const label = `${column.label} for ${row.name}`;

    /* ---------- Project Name: renames the project ---------- */
    if (type === "name") {
      const input = el("input", { class: "tracker-name", maxlength: "80", "aria-label": "Project name", value: row.name });
      input.addEventListener("change", () => {
        Projects.renameById(row.id, input.value);
        row.name = Projects.list().find(p => p.id === row.id)?.name || input.value;
        input.value = row.name;
        document.dispatchEvent(new Event("projects-changed"));
      });
      td.append(el("div", { class: "tracker-name-cell" }, input,
        el("div", { class: "tracker-name-actions" },
          row.active && el("span", { class: "badge" }, "Active"),
          row.archived && el("span", { class: "badge" }, "Archived"),
          !row.active && el("button", { type: "button", class: "comment-action", onclick: () => {
            Projects.switchTo(row.id);   // (also takes it out of the archive)
            location.reload();
          } }, "Make active"),
          !row.active && el("button", { type: "button", class: "comment-action", onclick: () => {
            Projects.setArchived(row.id, !row.archived);
            document.dispatchEvent(new Event("projects-changed"));
            renderTable();
          } }, row.archived ? "Unarchive" : "Archive"))));
      return td;
    }

    /* ---------- Goals: a summary that opens the goal cards ---------- */
    if (type === "goals") {
      const button = el("button", {
        type: "button", class: "tracker-goals-toggle",
        "aria-expanded": String(view.open.includes(row.id)),
        "aria-label": `Goals for ${row.name}`,
        onclick: () => toggleGoals(row, button),
      });
      fillGoalSummary(button, row.record);
      td.append(button);
      return td;
    }

    /* ---------- Team Members: from the project's Team page ---------- */
    if (type === "team") {
      td.append(teamCell(row));
      return td;
    }

    /* ---------- Dropdowns ---------- */
    if (type === "select") {
      const select = el("select", { "aria-label": label },
        column.options.map(o => el("option", { value: o }, o)));
      select.value = column.options.includes(record[key]) ? record[key] : column.options[0];
      select.dataset.value = select.value;
      select.addEventListener("change", () => {
        record[key] = select.value;
        select.dataset.value = select.value;
        saveRow(row);
        if (key === "status") { markOverdue(td.closest("tr"), row); renderFilters(); }
      });
      td.append(select);
      return td;
    }

    /* ---------- Links: the address, plus ↗ to open it ---------- */
    if (type === "link") {
      const input = el("input", { type: "text", inputmode: "url", placeholder: "https://…", "aria-label": label, value: record[key] });
      const open = el("a", { class: "tracker-open", target: "_blank", rel: "noopener noreferrer", title: "Open link", "aria-label": `Open ${column.label.toLowerCase()}` }, "↗");
      const update = () => {
        const href = safeUrl(input.value.trim());
        open.hidden = !href;
        if (href) open.href = href;
        input.setAttribute("aria-invalid", String(!!input.value.trim() && !href));
      };
      input.addEventListener("input", () => { record[key] = input.value.trim(); update(); saveRow(row, { soon: true }); });
      update();
      td.append(el("div", { class: "tracker-link" }, input, open));
      return td;
    }

    /* ---------- Dates: type them, or use the calendar ---------- */
    if (type === "date") {
      const input = el("input", { type: "text", placeholder: "Type a date", "aria-label": label, value: formatDate(record[key]),
                                  autocomplete: "off", spellcheck: "false" });
      const picker = el("input", { type: "date", class: "tracker-picker", tabindex: "-1", "aria-hidden": "true", value: record[key] });
      const button = el("button", { type: "button", class: "tracker-pick", title: "Pick a date", "aria-label": `Pick ${column.label.toLowerCase()}` },
        calendarIcon());

      const commit = (iso) => {
        record[key] = iso;
        input.value = formatDate(iso);
        picker.value = iso;
        input.setAttribute("aria-invalid", "false");
        input.title = "";
        saveRow(row);
        markOverdue(td.closest("tr"), row);
      };

      // Read the typed date when you leave the box or press Enter
      const read = () => {
        const iso = parseDate(input.value);
        if (iso === null) {
          input.setAttribute("aria-invalid", "true");
          input.title = "Couldn't read that date. Try 12 Oct 2026 or 2026-10-12.";
          return;
        }
        if (iso !== record[key] || input.value !== formatDate(iso)) commit(iso);
      };
      input.addEventListener("blur", read);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); read(); }
        if (event.key === "Escape") { input.value = formatDate(record[key]); input.setAttribute("aria-invalid", "false"); }
      });

      button.addEventListener("click", () => {
        try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
      });
      picker.addEventListener("change", () => commit(picker.value));

      td.append(el("div", { class: "tracker-date" }, input, button, picker));
      return td;
    }

    /* ---------- Notes ---------- */
    if (type === "textarea") {
      const textarea = el("textarea", { rows: "2", "aria-label": label });
      textarea.value = record[key];
      textarea.addEventListener("input", () => { record[key] = textarea.value; saveRow(row, { soon: true }); });
      td.append(textarea);
      return td;
    }

    /* ---------- Plain text ---------- */
    const input = el("input", { type: "text", "aria-label": label, value: record[key], list: column.list, placeholder: column.placeholder });
    input.addEventListener("input", () => { record[key] = input.value; saveRow(row, { soon: true }); });
    td.append(input);
    return td;
  }

  function calendarIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = '<rect x="3.5" y="5" width="17" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    return svg;
  }

  /* Name tags for the project's team, a link to edit it, and any names
     typed into this column before it was linked to the Team page */
  function teamCell(row) {
    const box = el("div", { class: "tracker-team" });
    const draw = () => {
      const typed = row.record.team.trim();
      box.replaceChildren(
        row.team.length
          ? el("ul", { class: "tracker-team-list", "aria-label": `Team for ${row.name}` }, row.team.map(m =>
              el("li", { class: "tracker-team-chip", title: (m.roles || []).join(", ") || "No role yet" }, m.name || "Unnamed")))
          : el("span", { class: "tracker-team-empty" }, "No team yet"),
        typed && el("p", { class: "tracker-team-typed" }, "Typed here: ", typed, " ",
          el("button", { type: "button", class: "comment-action", onclick: () => { moveTypedNamesToTeam(row); draw(); } }, "Add to team")),
        el("a", { class: "tracker-team-edit", href: `team.html?project=${encodeURIComponent(row.id)}` },
          row.team.length ? "Edit team →" : "Add people →"));
    };
    draw();
    return box;
  }

  /* Turns "Aisha, Sam" typed in the old Team Members column into people on
     the Team page (skipping anyone already there), then clears the typed text */
  function moveTypedNamesToTeam(row) {
    const known = new Set(row.team.map(m => m.name.trim().toLowerCase()));
    const names = row.record.team.split(/[,;\n]+|\s+and\s+/).map(n => n.trim()).filter(Boolean);
    const team = Projects.getDataFor(row.id, "team", []);
    const list = Array.isArray(team) ? team : [];
    names.forEach(name => {
      if (known.has(name.toLowerCase())) return;
      known.add(name.toLowerCase());
      list.push({
        id: newId("m"), name, pronouns: "", roles: [], email: "", phone: "",
        preferred: "", other: "", location: "", notes: "", added: Date.now(),
      });
    });
    Projects.setDataFor(row.id, "team", list);
    row.team = teamOf(row.id);
    row.record.team = "";
    saveRow(row);
  }

  /* Red date when a target has passed and the work isn't done */
  function markOverdue(tr, row) {
    if (!tr) return;
    ["targetCompletion", "targetPublication"].forEach(key => {
      const td = tr.querySelector(`[data-key="${key}"]`);
      const late = overdue(row.record, key);
      td.classList.toggle("is-overdue", late);
      td.title = late ? (key === "targetCompletion" ? "Past the target, not finished yet" : "Past the target, not published yet") : "";
    });
  }


  /* =========================================================
     GOALS (cards under a project's row, like the template)
     ========================================================= */

  const blankGoal = () => ({ id: newId("g"), name: "", tasks: [], people: "", status: STATUSES[0], barriers: [] });

  // Has anything been typed into this goal? (blank starter lines don't count)
  const hasContent = (goal) => !!(goal.name.trim() || goal.people.trim()
    || goal.tasks.some(t => t.text.trim()) || goal.barriers.some(b => b.trim()));

  /* Boxes that grow to fit their text (wraps like the template instead of cutting off).
     Newer browsers do this with CSS (field-sizing); others get a little help here. */
  const growsByItself = window.CSS?.supports?.("field-sizing", "content");
  function growingBox(props, value, onInput) {
    const box = el("textarea", { rows: "1", class: `goal-grow ${props.class || ""}`.trim(), placeholder: props.placeholder, "aria-label": props["aria-label"] });
    box.value = value;
    const fit = () => {
      if (growsByItself) return;
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight}px`;
    };
    box.addEventListener("input", () => { fit(); onInput(box.value); });
    requestAnimationFrame(fit);
    return box;
  }

  const goalsDone = (record) => record.goals.filter(g => hasContent(g) && g.status === "Done").length;

  // Sets the goal cards' width to the visible part of the table
  function fitGoalRows() {
    const wrap = document.querySelector(".tracker-wrap");
    wrap.style.setProperty("--wrap-w", `${wrap.clientWidth}px`);
  }

  /* "▸ 1 of 4 done · 3/8 tasks" in the Goals column */
  function fillGoalSummary(button, record) {
    const goals = record.goals.filter(hasContent);
    const tasks = record.goals.flatMap(g => g.tasks).filter(t => t.text.trim());
    const open = button.getAttribute("aria-expanded") === "true";
    button.replaceChildren(
      el("span", { class: "tracker-goals-arrow", "aria-hidden": "true" }, open ? "▾" : "▸"),
      goals.length
        ? el("span", {}, `${goalsDone(record)} of ${goals.length} done`,
            tasks.length ? el("span", { class: "tracker-goals-tasks" }, `${tasks.filter(t => t.done).length}/${tasks.length} tasks`) : null)
        : el("span", { class: "tracker-goals-empty" }, "Add goals"));
  }

  function toggleGoals(row, button) {
    const tr = button.closest("tr");
    const open = !view.open.includes(row.id);
    view.open = open ? [...view.open, row.id] : view.open.filter(id => id !== row.id);
    saveView();
    button.setAttribute("aria-expanded", String(open));
    fillGoalSummary(button, row.record);
    if (open) {
      fitGoalRows();
      tr.after(goalsRow(row));
      tr.nextElementSibling.querySelector(".goal-name")?.focus();
    } else if (tr.nextElementSibling?.classList.contains("tracker-goals-row")) {
      tr.nextElementSibling.remove();
    }
  }

  /* The row of goal cards, spanning the whole table */
  function goalsRow(row) {
    const record = row.record;
    // First time: four empty goals, like the template (saved once you type in one)
    if (row.seedGoals && !record.goals.length) {
      for (let i = 0; i < STARTING_GOALS; i++) record.goals.push(blankGoal());
    }
    row.seedGoals = false;

    const grid = el("div", { class: "goal-grid" });
    const holder = el("div", { class: "goal-holder" }, grid,
      el("button", { type: "button", class: "small-btn goal-add", onclick: () => {
        const goal = blankGoal();
        record.goals.push(goal);
        changed();
        drawCards();
        grid.lastElementChild.querySelector(".goal-name").focus();
      } }, "+ Add goal"));

    // Keeps the summary in the Goals column up to date, and saves
    const changed = ({ soon = false } = {}) => {
      saveRow(row, { soon });
      const button = $("tracker-table").querySelector(`tr[data-id="${CSS.escape(row.id)}"] .tracker-goals-toggle`);
      if (button) fillGoalSummary(button, record);
    };

    const drawCards = () => {
      grid.replaceChildren(...record.goals.map((goal, i) => goalCard(record, goal, i, { changed, redraw: drawCards })));
      grid.hidden = !record.goals.length;
      empty.hidden = record.goals.length > 0;
    };
    const empty = el("p", { class: "goal-empty" }, "No goals. Add one to start planning.");
    holder.prepend(empty);
    drawCards();

    return el("tr", { class: "tracker-goals-row", dataset: { goalsFor: row.id } },
      el("td", { colspan: String(COLUMNS.length) }, holder));
  }

  function goalCard(record, goal, i, { changed, redraw }) {
    const name = growingBox({ class: "goal-name", placeholder: "Name of goal", "aria-label": `Goal ${i + 1} name` }, goal.name,
      (text) => { goal.name = text.replace(/\n/g, " "); changed({ soon: true }); });
    // Enter in the name jumps to the first sub-task instead of starting a new line
    name.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      name.closest(".goal-card").querySelector(".goal-list--task textarea")?.focus();
    });

    const people = el("input", { placeholder: "Who's working on it", "aria-label": `People involved in goal ${i + 1}`, value: goal.people });
    people.addEventListener("input", () => { goal.people = people.value; changed({ soon: true }); });

    const status = el("select", { class: "goal-status", "aria-label": `Status of goal ${i + 1}` },
      STATUSES.map(s => el("option", { value: s }, s)));
    status.value = goal.status;
    status.dataset.value = goal.status;
    status.addEventListener("change", () => {
      goal.status = status.value;
      status.dataset.value = status.value;
      changed();
    });

    const remove = el("button", { type: "button", class: "comment-action goal-remove", "aria-label": `Remove goal ${i + 1}`, onclick: () => {
      if (hasContent(goal) && !confirm(`Remove goal #${i + 1}${goal.name.trim() ? ` (“${goal.name.trim()}”)` : ""}?`)) return;
      record.goals.splice(i, 1);
      changed();
      redraw();
    } }, "Remove goal");

    return el("article", { class: "goal-card" },
      el("header", { class: "goal-row goal-head" },
        el("span", { class: "goal-number" }, `Goal #${i + 1}:`), name),
      el("div", { class: "goal-row" },
        editableList({
          items: goal.tasks, kind: "task", label: `Sub-tasks for goal ${i + 1}`,
          addLabel: "+ Sub-task", placeholder: "Sub-task", changed,
        })),
      el("label", { class: "goal-row goal-people" }, el("span", { class: "visually-hidden" }, "People involved"), people),
      el("div", { class: "goal-row goal-label" }, "Status:"),
      el("div", { class: "goal-row" }, status),
      el("div", { class: "goal-row goal-label goal-label--center" }, "Barriers:"),
      el("div", { class: "goal-row" },
        editableList({
          items: goal.barriers, kind: "barrier", label: `Barriers for goal ${i + 1}`,
          addLabel: "+ Barrier", placeholder: "Problems with accomplishing this goal", changed,
        })),
      el("div", { class: "goal-row goal-foot" }, remove));
  }

  /* A list you can type into: Enter adds a line below, Backspace on an
     empty line removes it. Sub-tasks get a checkbox; barriers a bullet.
     Sub-tasks are { id, text, done }; barriers are plain text. */
  function editableList({ items, kind, label, addLabel, placeholder, changed }) {
    const list = el("ul", { class: `goal-list goal-list--${kind}`, "aria-label": label });
    const textOf = (i) => kind === "task" ? items[i].text : items[i];
    const setText = (i, text) => { if (kind === "task") items[i].text = text; else items[i] = text; };
    const blank = () => kind === "task" ? { id: newId("t"), text: "", done: false } : "";

    function draw(focusIndex) {
      list.replaceChildren(...items.map((item, i) => {
        const input = growingBox({ placeholder, "aria-label": `${kind === "task" ? "Sub-task" : "Barrier"} ${i + 1}` }, textOf(i),
          (text) => { setText(i, text.replace(/\n/g, " ")); changed({ soon: true }); });
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            items.splice(i + 1, 0, blank());
            changed();
            draw(i + 1);
          }
          if (event.key === "Backspace" && !input.value && items.length) {
            event.preventDefault();
            items.splice(i, 1);
            changed();
            draw(Math.max(0, i - 1));
          }
        });

        const check = kind === "task"
          ? el("input", { type: "checkbox", "aria-label": `Done: ${item.text || `sub-task ${i + 1}`}`, checked: item.done })
          : null;
        check?.addEventListener("change", () => {
          item.done = check.checked;
          li.classList.toggle("is-done", item.done);
          changed();
        });

        const li = el("li", { class: kind === "task" && item.done ? "is-done" : null },
          kind === "task" ? check : el("span", { class: "goal-bullet", "aria-hidden": "true" }, "•"),
          input,
          el("button", { type: "button", class: "goal-item-remove", "aria-label": `Remove ${kind === "task" ? "sub-task" : "barrier"} ${i + 1}`, onclick: () => {
            items.splice(i, 1);
            changed();
            draw();
          } }, "×"));
        return li;
      }));
      if (focusIndex != null) list.children[focusIndex]?.querySelector("textarea")?.focus();
    }

    // Start with one empty line, like the template
    if (!items.length) items.push(blank());
    draw();

    return el("div", { class: "goal-list-wrap" }, list,
      el("button", { type: "button", class: "comment-action goal-list-add", onclick: () => {
        items.push(blank());
        changed();
        draw(items.length - 1);
      } }, addLabel));
  }


  /* =========================================================
     DRAWING THE PAGE
     ========================================================= */

  let currentRows = [];

  function renderTable({ focusId } = {}) {
    currentRows = rows();
    const visible = visibleRows(currentRows);

    // Header: click a column name to sort by it (again to reverse)
    const head = el("tr", {}, COLUMNS.map(column => {
      const sorted = view.sort === column.key;
      return el("th", {
        scope: "col", dataset: { key: column.key },
        "aria-sort": sorted ? (view.dir === 1 ? "ascending" : "descending") : null,
      },
        el("button", { type: "button", class: "tracker-sort", onclick: () => {
          view.dir = sorted ? -view.dir : 1;
          view.sort = column.key;
          saveView();
          renderTable();
        } }, column.label, el("span", { class: "tracker-arrow", "aria-hidden": "true" }, sorted ? (view.dir === 1 ? "▲" : "▼") : "")));
    }));

    const body = el("tbody", {}, visible.flatMap(row => {
      const tr = el("tr", { dataset: { id: row.id }, class: [row.active && "is-active", row.archived && "is-archived"].filter(Boolean).join(" ") || null },
        COLUMNS.map(column => cell(row, column)));
      markOverdue(tr, row);
      return view.open.includes(row.id) ? [tr, goalsRow(row)] : [tr];
    }));

    $("tracker-table").replaceChildren(el("thead", {}, head), body);
    $("tracker-empty").hidden = visible.length > 0;
    $("tracker-empty").textContent = currentRows.some(row => view.showArchived || !row.archived)
      ? "No projects match. Clear the search or pick All."
      : "Every project is archived. Tick Show archived to see them.";
    renderFilters();

    if (focusId) {
      const input = $("tracker-table").querySelector(`tr[data-id="${CSS.escape(focusId)}"] .tracker-name`);
      input?.focus();
      input?.select();
    }
  }

  /* Status buttons with counts; click one to show only those projects */
  function renderFilters() {
    const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    const shown = currentRows.filter(row => view.showArchived || !row.archived);
    shown.forEach(row => { if (row.record.status in counts) counts[row.record.status]++; });

    const archived = currentRows.filter(row => row.archived).length;
    $("tracker-archived-label").textContent = `Show archived (${archived})`;
    $("tracker-show-archived").checked = view.showArchived;

    const button = (value, text) => el("button", {
      type: "button", "aria-pressed": String(view.status === value),
      dataset: { status: value },
      onclick: () => { view.status = value; saveView(); renderTable(); },
    }, text);

    $("tracker-filters").replaceChildren(
      button("", `All (${shown.length})`),
      ...STATUSES.map(s => button(s, `${s} (${counts[s]})`)));
  }


  /* =========================================================
     EXPORT (CSV for spreadsheets)
     ========================================================= */

  const csvField = Cobbler.csvField;

  /* Goals as readable text for one spreadsheet cell, e.g.
     Goal 1: Book interviews [Some Progress]
       [x] Email the council  [ ] Call Sam
       People: Aisha
       Barriers: No reply yet */
  function goalsText(record) {
    return record.goals
      .filter(hasContent)
      .map((g, i) => [
        `Goal ${i + 1}: ${g.name.trim() || "(no name)"} [${g.status}]`,
        g.tasks.some(t => t.text.trim()) && "  " + g.tasks.filter(t => t.text.trim()).map(t => `[${t.done ? "x" : " "}] ${t.text.trim()}`).join("  "),
        g.people.trim() && `  People: ${g.people.trim()}`,
        g.barriers.some(b => b.trim()) && `  Barriers: ${g.barriers.filter(b => b.trim()).join("; ")}`,
      ].filter(Boolean).join("\n"))
      .join("\n");
  }

  // "Sam Rivera (Producer, Camera); Dana Okafor (Reporter)", plus anything typed before
  function teamText(row) {
    return [
      ...row.team.map(m => (m.roles || []).length ? `${m.name} (${m.roles.join(", ")})` : m.name),
      row.record.team.trim(),
    ].filter(Boolean).join("; ");
  }

  function exportCSV() {
    const lines = [COLUMNS.map(c => c.label).map(csvField).join(",")];
    visibleRows(rows()).forEach(row =>
      lines.push(COLUMNS.map(c =>
          c.key === "name" ? row.name
        : c.key === "goals" ? goalsText(row.record)
        : c.key === "team" ? teamText(row)
        : row.record[c.key])
        .map(csvField).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `project-tracker-${todayISO()}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    // Medium suggestions
    $("tracker-media").append(...MEDIA.map(m => el("option", { value: m })));

    // Search
    const search = $("tracker-search");
    search.value = view.search;
    search.addEventListener("input", () => {
      view.search = search.value;
      saveView();
      renderTable();
      search.focus();
    });

    // Add a project (stays on the project you're in)
    $("tracker-add").addEventListener("click", () => {
      const id = Projects.create("Untitled project", { activate: false });
      view.status = "";
      view.search = "";
      search.value = "";
      saveView();
      document.dispatchEvent(new Event("projects-changed"));
      renderTable({ focusId: id });
    });

    $("tracker-export").addEventListener("click", exportCSV);

    $("tracker-show-archived").addEventListener("change", (event) => {
      view.showArchived = event.target.checked;
      saveView();
      renderTable();
    });

    // Goal cards stay as wide as the visible table, even when it's scrolled sideways
    fitGoalRows();
    new ResizeObserver(fitGoalRows).observe(document.querySelector(".tracker-wrap"));

    // Names changed elsewhere (e.g. the Projects panel): update them without redrawing
    document.addEventListener("projects-changed", () => {
      const names = Object.fromEntries(Projects.list().map(p => [p.id, p.name]));
      document.querySelectorAll("#tracker-table tbody tr").forEach(tr => {
        const input = tr.querySelector(".tracker-name");
        if (input && input !== document.activeElement && names[tr.dataset.id]) input.value = names[tr.dataset.id];
      });
    });

    renderTable();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    timers.forEach(clearTimeout);
    timers.clear();
    renderTable();
    event.detail.handled = true;
  });
})();
