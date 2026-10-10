/* =========================================================
   interviews.js — the Interviews page
   ---------------------------------------------------------
   Three tabs:
     People          a board of people by stage, from researching
                     to filmed, then follow-up requested / complete; each person has shoot details, a
                     logistics checklist, release tracking and the
                     questions picked for them
     Shoot schedule  every shoot in date order (plus a calendar file)
     Question bank   questions grouped by topic

   "Questions as PDF" (in a person's window) prints the questions
   picked for them: titled with their name, a tick box per question,
   double spaced so a printed copy has room for notes.

   Saved inside the active project:
     project.data.interviewees = [{
       id, name, role, contact, stage, notes,
       shootDate: "2026-10-20", shootTime: "14:00", location,
       release: { status, date, notes },
       checklist: [{ id, text, done }],
       questionIds: ["q…"],
       added,
     }, ...]
     project.data.questions = [{ id, text, category, added }, ...]

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("interviews.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);


  /* =========================================================
     SETTINGS
     ========================================================= */

  const STAGES = ["Researching", "Reached out", "Pre-interview", "Scheduled", "Filmed", "Follow Up Requested", "Follow Up Complete"];
  const filmed = (p) => STAGES.indexOf(p.stage) >= STAGES.indexOf("Filmed");   // filmed, or in follow-up
  const RELEASE = ["Not sent", "Sent", "Signed", "Declined"];

  // Every new person starts with this checklist (edit it per person)
  const CHECKLIST = [
    "Confirm date and time", "Book the location", "Send the release form", "Share topics in advance (if appropriate)",
    "Check and pack equipment", "Arrange travel and parking", "Send a reminder the day before", "Send a thank-you afterwards",
  ];

  // "Add starter questions": general documentary interview questions to edit or delete
  const STARTER_QUESTIONS = [
    ["Background", "Can you tell me who you are and what you do?"],
    ["Background", "How did you first get involved in this?"],
    ["Background", "What did a normal day look like before all this?"],
    ["The story", "Take me back to the moment you realised something had changed. Where were you?"],
    ["The story", "What happened next?"],
    ["The story", "Who else was affected, and how?"],
    ["The story", "What did you try to do about it?"],
    ["Reflection", "How did that make you feel at the time? And now?"],
    ["Reflection", "What do people misunderstand about this?"],
    ["Reflection", "What would you say to someone going through the same thing?"],
    ["Closing", "Is there anything I didn't ask that you think matters?"],
    ["Closing", "Who else should I talk to?"],
  ];


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const newId = Cobbler.newId;
  const pad = Cobbler.pad;
  const todayISO = Cobbler.todayISO;

  // "2026-10-20" → "Tue 20 Oct 2026"
  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  }
  // "14:00" → "2:00 PM" (in this computer's style)
  function formatTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  const download = Cobbler.download;


  /* =========================================================
     SAVED DATA
     ========================================================= */

  let people = [], questions = [];
  function loadData() {
    people = Projects.getData("interviewees", []);
    if (!Array.isArray(people)) people = [];
    people.forEach(p => {
      p.stage = STAGES.includes(p.stage) ? p.stage : STAGES[0];
      p.release = { status: "Not sent", date: "", notes: "", ...(p.release || {}) };
      p.checklist = Array.isArray(p.checklist) ? p.checklist : [];
      p.questionIds = Array.isArray(p.questionIds) ? p.questionIds : [];
      for (const key of ["name", "role", "contact", "notes", "shootDate", "shootTime", "location"]) p[key] ??= "";
    });
    questions = Projects.getData("questions", []);
    if (!Array.isArray(questions)) questions = [];
  }
  loadData();

  const savePeople = () => Projects.setData("interviewees", people);
  const saveQuestions = () => Projects.setData("questions", questions);

  const categories = () => [...new Set(questions.map(q => q.category || "General"))];
  const checklistDone = (p) => `${p.checklist.filter(c => c.done).length}/${p.checklist.length}`;


  /* =========================================================
     TABS
     ========================================================= */

  function showTab(name) {
    document.querySelectorAll("#iv-tabs [role=tab]").forEach(b => {
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
      b.tabIndex = b.dataset.tab === name ? 0 : -1;
    });
    ["board", "schedule", "questions"].forEach(t => { $(`iv-panel-${t}`).hidden = t !== name; });
    history.replaceState(null, "", name === "board" ? location.pathname : `#${name}`);
    ({ board: renderBoard, schedule: renderSchedule, questions: renderQuestions })[name]();
  }

  const renderAll = () => {
    const tab = document.querySelector("#iv-tabs [aria-selected=true]")?.dataset.tab || "board";
    ({ board: renderBoard, schedule: renderSchedule, questions: renderQuestions })[tab]();
  };


  /* =========================================================
     PEOPLE BOARD
     ========================================================= */

  let dragged = null;

  function renderBoard() {
    $("iv-board").replaceChildren(...STAGES.map((stage, s) => {
      const list = el("ol", { class: "iv-cards", "aria-label": stage },
        people.filter(p => p.stage === stage).map(p => personCard(p, s)));
      if (!list.children.length) list.append(el("li", { class: "ideas-empty" }, "Nobody here"));

      list.addEventListener("dragover", (event) => { if (dragged) { event.preventDefault(); list.classList.add("is-drop"); } });
      list.addEventListener("dragleave", (event) => { if (!list.contains(event.relatedTarget)) list.classList.remove("is-drop"); });
      list.addEventListener("drop", (event) => {
        event.preventDefault();
        list.classList.remove("is-drop");
        if (!dragged) return;
        dragged.stage = stage;
        dragged = null;
        savePeople();
        renderBoard();
      });

      return el("section", { class: "iv-column" },
        el("header", { class: "iv-column-head" }, el("h2", {}, stage),
          el("span", { class: "ideas-count" }, String(people.filter(p => p.stage === stage).length))),
        list);
    }));
  }

  function personCard(p, s) {
    const move = (delta) => { p.stage = STAGES[s + delta]; savePeople(); renderBoard(); };
    const release = p.release.status;
    const node = el("li", { class: "iv-card" },
      el("div", { class: "ideas-card-bar" },
        el("span", { class: "ideas-drag", title: "Drag to another stage", "aria-hidden": "true" }, "⠿"),
        el("button", { type: "button", class: "comment-action", "aria-label": `Move ${p.name} back a stage`, disabled: s === 0, onclick: () => move(-1) }, "←"),
        el("button", { type: "button", class: "comment-action", "aria-label": `Move ${p.name} on a stage`, disabled: s === STAGES.length - 1, onclick: () => move(1) }, "→")),
      el("button", { type: "button", class: "iv-card-name", onclick: () => openPerson(p) }, p.name || "Unnamed"),
      p.role && el("p", { class: "iv-card-role" }, p.role),
      el("ul", { class: "iv-card-facts" },
        p.shootDate && el("li", {}, `🎬 ${formatDate(p.shootDate)}${p.shootTime ? `, ${formatTime(p.shootTime)}` : ""}`),
        el("li", { class: `iv-release is-${release.toLowerCase().replace(/\s+/g, "-")}` },
          `${{ "Not sent": "○", "Sent": "◐", "Signed": "✓", "Declined": "✕" }[release]} Release: ${release}`),
        p.checklist.length > 0 && el("li", {}, `☑ Checklist ${checklistDone(p)}`),
        p.questionIds.length > 0 && el("li", {}, `? ${p.questionIds.length} question${p.questionIds.length === 1 ? "" : "s"}`)));

    const handle = node.querySelector(".ideas-drag");
    handle.addEventListener("pointerdown", () => { node.draggable = true; });
    node.addEventListener("dragstart", (event) => {
      dragged = p;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", p.name);
      node.classList.add("is-dragging");
    });
    node.addEventListener("dragend", () => { node.draggable = false; node.classList.remove("is-dragging"); dragged = null; });
    return node;
  }


  /* =========================================================
     ONE PERSON (dialog). Edits a copy, so Cancel throws them away.
     ========================================================= */

  let editing = null;   // the person being edited (null = new)
  let draft = null;     // the copy being changed

  function openPerson(person = null) {
    editing = person;
    draft = person ? JSON.parse(JSON.stringify(person)) : {
      id: newId("p"), name: "", role: "", contact: "", stage: STAGES[0], notes: "",
      shootDate: "", shootTime: "", location: "",
      release: { status: "Not sent", date: "", notes: "" },
      checklist: CHECKLIST.map(text => ({ id: newId("c"), text, done: false })),
      questionIds: [], added: Date.now(),
    };

    const form = $("iv-form");
    form.reset();
    for (const key of ["name", "role", "contact", "stage", "notes", "shootDate", "shootTime", "location"]) form.elements[key].value = draft[key];
    form.elements.releaseStatus.value = draft.release.status;
    form.elements.releaseDate.value = draft.release.date;
    form.elements.releaseNotes.value = draft.release.notes;

    $("iv-dialog-title").textContent = person ? person.name : "Add person";
    $("iv-delete").hidden = !person;
    drawChecklist();
    drawPersonQuestions();
    $("iv-dialog").showModal();
    form.elements.name.focus();
  }

  function drawChecklist(focusIndex) {
    const list = $("iv-checklist");
    list.replaceChildren(...draft.checklist.map((item, i) => {
      const check = el("input", { type: "checkbox", "aria-label": `Done: ${item.text || "item"}`, checked: item.done });
      check.addEventListener("change", () => { item.done = check.checked; li.classList.toggle("is-done", item.done); });
      const text = el("input", { class: "goal-grow", value: item.text, "aria-label": `Checklist item ${i + 1}`, placeholder: "Something to do" });
      text.addEventListener("input", () => { item.text = text.value; });
      text.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); draft.checklist.splice(i + 1, 0, { id: newId("c"), text: "", done: false }); drawChecklist(i + 1); }
        if (event.key === "Backspace" && !text.value) { event.preventDefault(); draft.checklist.splice(i, 1); drawChecklist(Math.max(0, i - 1)); }
      });
      const li = el("li", { class: item.done ? "is-done" : null }, check, text,
        el("button", { type: "button", class: "goal-item-remove", "aria-label": `Remove ${item.text || "item"}`, onclick: () => { draft.checklist.splice(i, 1); drawChecklist(); } }, "×"));
      return li;
    }));
    if (focusIndex != null) list.children[focusIndex]?.querySelector("input:not([type=checkbox])")?.focus();
  }

  /* Tick questions from the bank for this person (or add a new one) */
  function drawPersonQuestions() {
    const box = $("iv-person-questions");
    const newQuestion = el("input", { placeholder: "Add a new question to the bank and to this interview", maxlength: "500", "aria-label": "New question" });
    newQuestion.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const text = newQuestion.value.trim();
      if (!text) return;
      const q = { id: newId("q"), text, category: "General", added: Date.now() };
      questions.push(q);
      saveQuestions();
      draft.questionIds.push(q.id);
      drawPersonQuestions();
      box.querySelector("input:not([type=checkbox])")?.focus();
    });

    box.replaceChildren(
      questions.length
        ? categories().map(cat => el("div", { class: "iv-q-group" },
            el("p", { class: "iv-q-cat" }, cat),
            questions.filter(q => (q.category || "General") === cat).map(q => {
              const tick = el("input", { type: "checkbox", checked: draft.questionIds.includes(q.id) });
              tick.addEventListener("change", () => {
                draft.questionIds = tick.checked ? [...draft.questionIds, q.id] : draft.questionIds.filter(id => id !== q.id);
              });
              return el("label", { class: "iv-q-pick" }, tick, q.text);
            })))
        : el("p", { class: "media-muted" }, "Your question bank is empty. Add questions on the Question bank tab, or type one below."),
      newQuestion);
  }

  /* The questions picked for this person, as a double-spaced PDF to annotate */
  function questionsPDF() {
    const form = $("iv-form");
    const name = form.elements.name.value.trim() || "Interview";
    const picked = questions.filter(q => draft.questionIds.includes(q.id));
    if (!picked.length) {
      alert("Tick some questions for this interview first (under “Questions for this interview”).");
      return;
    }
    const when = [form.elements.shootDate.value && formatDate(form.elements.shootDate.value),
                  formatTime(form.elements.shootTime.value), form.elements.location.value.trim()].filter(Boolean).join(" · ");
    const blocks = [
      { t: "title", text: name },
      { t: "meta", text: [form.elements.role.value.trim(), when, Projects.activeName()].filter(Boolean).join("\n") },
    ];
    // Grouped by topic, in the bank's order
    [...new Set(picked.map(q => q.category || "General"))].forEach(topic => {
      blocks.push({ t: "h2", text: topic }, { t: "checks", items: picked.filter(q => (q.category || "General") === topic).map(q => q.text) });
    });
    DocExport.print(blocks, { title: name, spacing: "double" });
  }

  function setUpDialog() {
    const dialog = $("iv-dialog");
    const form = $("iv-form");
    $("iv-questions-pdf").addEventListener("click", questionsPDF);
    $("iv-stage").append(...STAGES.map(s => el("option", { value: s }, s)));
    $("iv-release").append(...RELEASE.map(s => el("option", { value: s }, s)));

    $("iv-check-add").addEventListener("click", () => {
      draft.checklist.push({ id: newId("c"), text: "", done: false });
      drawChecklist(draft.checklist.length - 1);
    });
    $("iv-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    $("iv-delete").addEventListener("click", () => {
      if (!editing || !confirm(`Remove ${editing.name} and their checklist and release details?`)) return;
      people = people.filter(p => p !== editing);
      savePeople();
      dialog.close();
      renderAll();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      for (const key of ["name", "role", "contact", "stage", "notes", "shootDate", "shootTime", "location"]) {
        draft[key] = String(data.get(key) || "").trim();
      }
      draft.release = {
        status: String(data.get("releaseStatus")),
        date: String(data.get("releaseDate") || ""),
        notes: String(data.get("releaseNotes") || "").trim(),
      };
      draft.checklist = draft.checklist.filter(c => c.text.trim());
      // Picking a shoot date moves early-stage people to Scheduled
      if (draft.shootDate && STAGES.indexOf(draft.stage) < STAGES.indexOf("Scheduled") && !editing?.shootDate) draft.stage = "Scheduled";

      if (editing) Object.assign(editing, draft);
      else people.push(draft);
      savePeople();
      dialog.close();
      renderAll();
    });
  }


  /* =========================================================
     SHOOT SCHEDULE
     ========================================================= */

  function renderSchedule() {
    const today = todayISO();
    const dated = people.filter(p => p.shootDate)
      .sort((a, b) => (a.shootDate + a.shootTime).localeCompare(b.shootDate + b.shootTime));
    const upcoming = dated.filter(p => p.shootDate >= today);
    const past = dated.filter(p => p.shootDate < today).reverse();
    const undated = people.filter(p => !p.shootDate && !filmed(p));

    const table = (list, empty) => list.length
      ? el("div", { class: "tracker-wrap" }, el("table", { class: "tracker-table iv-schedule-table" },
          el("thead", {}, el("tr", {}, ["Date", "Time", "Who", "Location", "Stage", "Release", "Checklist"].map(h => el("th", { scope: "col" }, h)))),
          el("tbody", {}, list.map(p => el("tr", { class: p.shootDate === today ? "is-today" : null },
            el("td", {}, p.shootDate ? formatDate(p.shootDate) + (p.shootDate === today ? " (today)" : "") : "–"),
            el("td", {}, formatTime(p.shootTime) || "–"),
            el("th", { scope: "row" }, el("button", { type: "button", class: "comment-action", onclick: () => openPerson(p) }, p.name)),
            el("td", {}, p.location || "–"),
            el("td", {}, p.stage),
            el("td", {}, p.release.status),
            el("td", {}, p.checklist.length ? checklistDone(p) : "–"))))))
      : el("p", { class: "media-empty" }, empty);

    $("iv-schedule").replaceChildren(...[
      el("div", { class: "sketch-nav" },
        el("button", { type: "button", class: "small-btn", disabled: !dated.length, onclick: downloadCalendar }, "Download calendar (.ics)"),
        el("p", { class: "media-muted" }, "Set shoot dates on each person's card. The calendar file opens in Apple Calendar, Google Calendar or Outlook.")),
      el("section", { class: "media-section" }, el("h2", { class: "iv-h2" }, "Upcoming"), table(upcoming, "No upcoming shoots.")),
      el("section", { class: "media-section" }, el("h2", { class: "iv-h2" }, "Not scheduled yet"), table(undated, "Everyone still to film has a date.")),
      past.length > 0 && el("section", { class: "media-section" }, el("h2", { class: "iv-h2" }, "Past"), table(past, ""))].filter(Boolean));
  }

  /* Every dated shoot as a calendar event (1 hour if there's a time, all day if not) */
  function downloadCalendar() {
    const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const events = people.filter(p => p.shootDate).map(p => {
      const day = p.shootDate.replace(/-/g, "");
      let when;
      if (p.shootTime) {
        const [h, m] = p.shootTime.split(":").map(Number);
        const end = h >= 23 ? "235900" : `${pad(h + 1)}${pad(m)}00`;   // an hour long, ending by midnight
        when = [`DTSTART:${day}T${pad(h)}${pad(m)}00`, `DTEND:${day}T${end}`];
      } else {
        const [y, mo, d] = p.shootDate.split("-").map(Number);
        const next = new Date(y, mo - 1, d + 1);
        when = [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`];
      }
      return ["BEGIN:VEVENT", `UID:${p.id}@cobbler-project`, `DTSTAMP:${stamp}`, ...when,
        `SUMMARY:${esc(`Interview: ${p.name}`)}`,
        p.location && `LOCATION:${esc(p.location)}`,
        `DESCRIPTION:${esc([p.role, p.contact && `Contact: ${p.contact}`, `Release: ${p.release.status}`].filter(Boolean).join("\n"))}`,
        "END:VEVENT"].filter(Boolean).join("\r\n");
    });
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Cobbler Project//Interviews//EN", ...events, "END:VCALENDAR"].join("\r\n");
    download(ics, "interview-shoots.ics", "text/calendar");
  }


  /* =========================================================
     QUESTION BANK
     ========================================================= */

  function renderQuestions() {
    $("iv-categories").replaceChildren(...categories().map(c => el("option", { value: c })));
    const box = $("iv-questions");
    if (!questions.length) {
      box.replaceChildren(el("p", { class: "media-empty" }, "No questions yet. Add your own above, or start from a set of general documentary questions."));
      return;
    }
    box.replaceChildren(...categories().map(cat => el("section", { class: "iv-q-section" },
      el("h2", { class: "iv-h2" }, cat),
      el("ol", { class: "iv-q-list" }, questions.filter(q => (q.category || "General") === cat).map(q => {
        const used = people.filter(p => p.questionIds.includes(q.id)).map(p => p.name);
        const text = el("input", { value: q.text, maxlength: "500", "aria-label": "Question" });
        text.addEventListener("change", () => { q.text = text.value.trim() || q.text; saveQuestions(); });
        const topic = el("input", { value: q.category || "General", maxlength: "40", list: "iv-categories", "aria-label": "Topic", class: "iv-q-topic" });
        topic.addEventListener("change", () => { q.category = topic.value.trim() || "General"; saveQuestions(); renderQuestions(); });
        return el("li", { class: "iv-q-row" }, text, topic,
          el("span", { class: "media-muted iv-q-used", title: used.join(", ") }, used.length ? `Asking ${used.length}` : "Not assigned"),
          el("button", { type: "button", class: "comment-action", "aria-label": `Delete question: ${q.text}`, onclick: () => {
            if (used.length && !confirm(`This question is picked for ${used.join(", ")}. Delete it anyway?`)) return;
            questions = questions.filter(x => x !== q);
            people.forEach(p => { p.questionIds = p.questionIds.filter(id => id !== q.id); });
            saveQuestions();
            savePeople();
            renderQuestions();
          } }, "Delete"));
      })))));
  }

  function setUpQuestions() {
    $("iv-question-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      questions.push({ id: newId("q"), text: String(data.get("text")).trim(), category: String(data.get("category") || "").trim() || "General", added: Date.now() });
      saveQuestions();
      event.target.elements.text.value = "";
      event.target.elements.text.focus();
      renderQuestions();
    });
    $("iv-starters").addEventListener("click", () => {
      const have = new Set(questions.map(q => q.text));
      const add = STARTER_QUESTIONS.filter(([, text]) => !have.has(text));
      if (!add.length) return;
      add.forEach(([category, text]) => questions.push({ id: newId("q"), text, category, added: Date.now() }));
      saveQuestions();
      renderQuestions();
    });
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    setUpQuestions();
    $("iv-add").addEventListener("click", () => openPerson());

    const tabs = [...document.querySelectorAll("#iv-tabs [role=tab]")];
    tabs.forEach((button, i) => {
      button.addEventListener("click", () => showTab(button.dataset.tab));
      button.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const next = tabs[(i + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        next.focus();
        next.click();
      });
    });
    const start = location.hash.slice(1);
    showTab(["schedule", "questions"].includes(start) ? start : "board");
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => { dragged = null; loadData(); renderAll(); event.detail.handled = true; });
})();
