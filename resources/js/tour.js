/* =========================================================
   tour.js — the tutorial: a guided walk through every page
   ---------------------------------------------------------
   Settings › Tutorial (and "Take the tour" on Home) starts a tour
   that goes page by page, pointing at the thing it's talking about
   with a spotlight and a card: what it is, how to use it, and the
   tips people miss. Next, Back, Skip; Esc leaves at any time. The
   tour remembers where it got to (localStorage "cobblerTour"), so
   it carries on across pages and after a break.

   Steps are listed in STEPS: a page, a thing on it (a CSS selector;
   none for a whole-page note), a title and the text. To add a step
   for a new page, add a line.

   Needs projects-core.js. Loads on every page (boot.js).
   ========================================================= */
(() => {

  const { el, $ } = Cobbler;
  const KEY = "cobblerTour";
  const here = location.pathname.split("/").pop() || "index.html";

  /* =========================================================
     THE STEPS
     ========================================================= */
  const STEPS = [
    { page: "index.html", title: "Welcome to The Cobbler Project", text: "This tour walks through every page and what it's for, in about ten minutes. Nothing you do during it is lost: it only points at things. Use Next and Back, or press Esc to leave; you can pick it up again from Settings › Tutorial." },
    { page: "index.html", target: ".nav-toggle", title: "The sidebar", text: "The ☰ button opens and closes the sidebar, which lists every page. On a computer it stays open beside the page; on a phone it slides over it." },
    { page: "index.html", target: "#project-button", title: "Projects", text: "Everything you make belongs to a project. This button shows which one is active and lets you switch, rename, back up or restore. Each page shows the active project's work; switching redraws the page in place." },
    { page: "index.html", target: "#site-search-input", title: "Search this project", text: "Finds anything in the active project: notes, ideas, tasks, people, transcripts, drafts, scripts, shots, comments… Results are grouped by page and open straight to the item. Ctrl+K (⌘K) jumps here from anywhere." },
    { page: "index.html", target: "#new-project-fab", title: "New project", text: "The + button starts a new project and shows it at once. Projects are separate: their own team, research, media and so on." },
    { page: "index.html", target: "#comments-fab", title: "Comments", text: "Comments on the page you're on, or on all pages in the project. Select text first to quote it; assign a comment to someone and it appears in their tasks. Collaborators' comments arrive through sharing or the sync folder." },
    { page: "index.html", target: "#account-fab", title: "You", text: "Sign in with your name (there's no password: it's just how your changes and comments are labelled for collaborators). Your initial shows while you're signed in." },
    { page: "index.html", target: "#ideas-fab", title: "Ideas, anywhere", text: "The lightbulb opens the project's ideas in a panel on the right, on any page: jot something, move it along with ← →, or drop it. It stays open from page to page until you close it." },
    { page: "index.html", target: "#dashboard", title: "Home", text: "What's coming up across your projects: dates, tasks for you, recent activity and who's working on what. Undo works on every page: Cmd/Ctrl+Z undoes your last change, Cmd/Ctrl+Shift+Z redoes it, and the page redraws itself." },
    { page: "project-tracker.html", target: "#tracker-table", title: "Project Tracker", text: "One row per project: type, status, dates, links to drives and folders, and goals with sub-tasks. Click a cell to edit; dates show on the Calendar. Archive finished projects to hide them without deleting." },
    { page: "team.html", target: "#team-add", title: "Team", text: "Who's on the project, with roles and contact details. Copy emails, download contact cards or a CSV, and make a credits roll. Tasks (below) give jobs to people with due dates; comments assigned to someone appear there too." },
    { page: "ideas.html", target: "#ideas-board", title: "Ideas", text: "A board with three columns you can rename. Type straight into a card, drag by ⠿ or use ← → to move it along, and “Pitch it →” turns an idea into a pitch." },
    { page: "research.html", target: "#research-new", title: "Research", text: "One note per claim, figure or lead: sources, tags and a status (unverified, verified, disputed). The Writing page's Check tab uses these to flag unverified claims in a draft." },
    { page: "interviews.html", target: "#iv-tabs", title: "Interviews", text: "People by stage, from researching to filmed and follow-up, each with shoot details, a logistics checklist, release form tracking and the questions picked for them. The shoot schedule exports to your calendar; Questions as PDF prints a double-spaced sheet to annotate." },
    { page: "calendar.html", target: "#cal-body", title: "Calendar", text: "Every date from every page in one place: tracker milestones, shoots, release forms, pitches sent, tasks due, shoot days, writing deadlines, gigs, plus your own events. Filter by source, download .ics, or print a month." },
    { page: "media-and-transcripts.html", target: "#media-tabs", title: "Media & Transcripts", text: "Import transcripts (SRT, VTT, text with timecodes) and markers from Resolve; search every line. Text Edit builds a paper edit from transcript paragraphs, and Export Timeline turns it into a timeline for DaVinci Resolve or Premiere. Long transcripts can live in file storage or a folder." },
    { page: "av-script.html", target: "main", title: "A/V Script", text: "A two-column script (audio and visuals) built from your paper edit, with linked storyboard frames beside each block. Export as PDF, Word or text for the edit or the client." },
    { page: "screenplay.html", target: "#sp-new", title: "Screenplay", text: "A proper screenplay editor: Tab and Enter move between scene heading, action, character, dialogue and so on; Ctrl+1–7 set the element type. Pages lay out to industry format, with a breakdown of props, cast and locations. Export PDF, Final Draft or Fountain; import Fountain." },
    { page: "storyboarder.html", target: "#sb-new", title: "Storyboarder", text: "Draw each shot with pen, marker and text, over a photo if you like, with framing guides for shot sizes. Play the animatic, print a storyboard sheet, and link frames to paper-edit blocks or shot list rows." },
    { page: "shot-list.html", target: "#sl-new", title: "Shot List", text: "One list per shoot day, scene or location. Shots are numbered from scene and order (12A, 12B…); add them by hand, from a storyboard's frames or one per screenplay scene. Tick them off on set. Exports: a call sheet (PDF or Word), the list as PDF, CSV for scheduling apps and a calendar file." },
    { page: "zine-planner.html", target: "#zine-new", title: "Zine Planner", text: "Plan a zine as booklet spreads at real paper sizes: sketch and type on every page, then upload mock-ups, PDFs or video to the Critique tab and pin comments to them." },
    { page: "writing.html", target: "#wr-tabs", title: "Writing", text: "Drafts with parts and scenes, a style check against your research, a story bible, reporting tools (sources, records requests, an event timeline), revisions with tracked changes, business (submissions, invoices) and daily word goals. Export manuscripts as Word, PDF or Markdown." },
    { page: "music.html", target: "#mu-tabs", title: "Music", text: "A song sketchbook: lyrics with chords above (transpose up or down), sheet music in ABC notation with playback, split sheets, sessions and versions with audio. Plus gigs and bookings, release plans and sample clearances." },
    { page: "pitches.html", target: "#pitch-new", title: "Pitches", text: "Each pitch with its formats, links and the outlets you've sent it to, with a status per outlet. “Copy email” writes the pitch email in your name." },
    { page: "packaging.html", target: "#pk-new", title: "Packaging", text: "Titles, thumbnails, descriptions, tags and SEO for each platform you publish on, with deliverables ticked off. “Copy everything” gives you the whole package as text." },
    { page: "data-analysis.html", target: "#da-load", title: "Data Analysis", text: "Load a CSV or an Excel file: a profile of every column, filters and a quick chart. The page writes the matching R code (tidyverse, ggplot2 or Datawrapper) to run in RStudio." },
    { page: "resources.html", target: "#add-form", title: "Resources", text: "A table of tools and links: a default set that comes with the app, plus your own, importable and exportable as CSV." },
    { page: "projects.html", target: "#project-grid", title: "Working with others", text: "Share a project as a file for collaborators to import; their changes merge back, item by item, with differences settled by newest wins and listed here. Lock a version, send a read-only copy for feedback, or sync everyone through a shared folder (Google Drive, Dropbox) on Chrome or Edge." },
    { page: "projects.html", target: "#sync", title: "Sync folder and activity", text: "Choose a shared folder once and the app merges everyone's changes every 30 seconds while it's open. Activity shows who changed what, and claims show who's working on what." },
    { page: "settings.html", target: "#backups", title: "Backups", text: "Your projects live only in this browser, so keep a copy elsewhere: choose a folder and the app backs everything up automatically, every day or week. Without that, a note reminds you weekly." },
    { page: "settings.html", target: "#storage", title: "Storage", text: "How much room projects and files take, which parts are biggest, trimming old history and keeping files safe when the disk is low." },
    { page: "settings.html", target: ".theme-switcher", title: "Themes", text: "Light, dark, rainbow or your computer's setting. The app also works offline once you've opened it, and Chrome or Edge can install it as an app." },
    { page: "settings.html", target: "#tutorial", title: "That's the tour", text: "You can run it again from here any time. The full guide (PDF, under Guides and downloads) goes into every page in detail, and the “First week” section at its top is a good next read. Enjoy making things." },
  ];

  const NAMES = {
    "index.html": "Home", "project-tracker.html": "Project Tracker", "team.html": "Team", "ideas.html": "Ideas", "research.html": "Research",
    "interviews.html": "Interviews", "calendar.html": "Calendar", "media-and-transcripts.html": "Media & Transcripts", "av-script.html": "A/V Script",
    "screenplay.html": "Screenplay", "storyboarder.html": "Storyboarder", "shot-list.html": "Shot List", "zine-planner.html": "Zine Planner",
    "writing.html": "Writing", "music.html": "Music", "pitches.html": "Pitches", "packaging.html": "Packaging", "data-analysis.html": "Data Analysis",
    "resources.html": "Resources", "projects.html": "Projects", "settings.html": "Settings",
  };


  /* =========================================================
     STATE
     ========================================================= */
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  let state = load();   // { step, startedAt } while a tour is running; null otherwise
  const save = () => { try { if (state) localStorage.setItem(KEY, JSON.stringify(state)); else localStorage.removeItem(KEY); } catch {} };

  function start(step = 0) {
    state = { step, startedAt: Date.now() };
    save();
    show();
  }
  function stop() {
    state = null;
    save();
    hide();
  }
  function goTo(step) {
    if (step < 0 || step >= STEPS.length) { finish(); return; }
    if (!state) state = { step, startedAt: Date.now() };   // (jumping in from Settings)
    state.step = step;
    save();
    if (STEPS[step].page !== here) {
      hide();
      location.href = STEPS[step].page;
      return;
    }
    show();
  }
  function finish() {
    try { localStorage.setItem("cobblerTourDone", String(Date.now())); } catch {}
    stop();
    window.CobblerSync?.toast?.("That's the whole tour. It's in Settings › Tutorial whenever you want it again.", [], { id: "tour-toast" });
  }


  /* =========================================================
     DRAWING: a spotlight on the target and a card beside it
     ========================================================= */
  let ui = null;   // { spot, card }

  function build() {
    if (ui) return ui;
    const spot = el("div", { class: "tour-spot", "aria-hidden": "true" });
    const card = el("section", { class: "tour-card", role: "dialog", "aria-labelledby": "tour-title", "aria-describedby": "tour-text", tabindex: "-1" });
    document.body.append(spot, card);
    ui = { spot, card };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    document.addEventListener("keydown", (event) => {
      if (!state) return;
      if (event.key === "Escape") { event.preventDefault(); stop(); }
      if (event.key === "ArrowRight" && card.contains(document.activeElement)) { event.preventDefault(); goTo(state.step + 1); }
      if (event.key === "ArrowLeft" && card.contains(document.activeElement)) { event.preventDefault(); goTo(state.step - 1); }
    });
    return ui;
  }

  const target = () => { const step = STEPS[state?.step]; return step?.target ? document.querySelector(step.target) : null; };

  function show() {
    if (!state) return;
    const step = STEPS[state.step];
    if (!step || step.page !== here) { showDetour(); return; }
    const { spot, card } = build();
    document.documentElement.classList.add("tour-open");
    const node = target();
    if (node) {
      // A target inside the sidebar on a phone needs the sidebar open
      if (node.closest(".main-header")) document.documentElement.classList.add("nav-open");
      node.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    card.replaceChildren(
      el("p", { class: "tour-count" }, `${state.step + 1} of ${STEPS.length} · ${NAMES[step.page] || step.page}`),
      el("h2", { id: "tour-title" }, step.title),
      el("p", { id: "tour-text" }, step.text),
      el("div", { class: "tour-actions" },
        el("button", { type: "button", class: "small-btn", disabled: state.step === 0, onclick: () => goTo(state.step - 1) }, "Back"),
        el("button", { type: "button", class: "small-btn tour-next", onclick: () => goTo(state.step + 1) }, state.step === STEPS.length - 1 ? "Finish" : "Next"),
        el("button", { type: "button", class: "comment-action", onclick: stop }, "Leave the tour")));
    spot.hidden = false;
    card.hidden = false;
    place();
    setTimeout(place, 350);   // after the smooth scroll
    card.querySelector(".tour-next").focus({ preventScroll: true });
  }

  /* The tour's step is on another page: offer to go there */
  function showDetour() {
    const { spot, card } = build();
    const step = STEPS[state.step];
    document.documentElement.classList.add("tour-open");
    spot.hidden = true;
    card.replaceChildren(
      el("p", { class: "tour-count" }, `${state.step + 1} of ${STEPS.length}`),
      el("h2", { id: "tour-title" }, "Carry on the tour?"),
      el("p", { id: "tour-text" }, `The next stop is ${NAMES[step.page] || step.page}: ${step.title}.`),
      el("div", { class: "tour-actions" },
        el("button", { type: "button", class: "small-btn tour-next", onclick: () => { location.href = step.page; } }, `Go to ${NAMES[step.page] || "the page"}`),
        el("button", { type: "button", class: "comment-action", onclick: stop }, "Leave the tour")));
    card.hidden = false;
    card.className = "tour-card is-centered";
    card.querySelector(".tour-next").focus({ preventScroll: true });
  }

  function place() {
    if (!ui || !state || ui.card.hidden) return;
    const { spot, card } = ui;
    const node = target();
    card.className = "tour-card";
    if (!node) {
      spot.hidden = true;
      card.classList.add("is-centered");
      return;
    }
    const r = node.getBoundingClientRect();
    const pad = 8;
    spot.hidden = false;
    Object.assign(spot.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    // The card goes below the target when there's room, else above, else beside; clamped to the window
    const cw = Math.min(26 * 16, window.innerWidth - 32);
    const ch = card.offsetHeight || 220;
    let top = r.bottom + pad + 12;
    if (top + ch > window.innerHeight - 16) top = r.top - pad - 12 - ch;
    if (top < 16) top = Math.max(16, Math.min(window.innerHeight - ch - 16, r.top));
    let left = r.left + r.width / 2 - cw / 2;
    if (r.width < 200 && r.right + cw + 24 < window.innerWidth && top === r.top) left = r.right + pad + 12;
    left = Math.max(16, Math.min(window.innerWidth - cw - 16, left));
    Object.assign(card.style, { top: `${top}px`, left: `${left}px`, width: `${cw}px` });
  }

  function hide() {
    document.documentElement.classList.remove("tour-open");
    if (!ui) return;
    ui.spot.hidden = true;
    ui.card.hidden = true;
  }


  /* =========================================================
     SETTINGS › TUTORIAL, AND THE HOME BUTTON
     ========================================================= */
  function renderPanel() {
    const box = $("tutorial-panel");
    if (!box) return;
    let done = 0; try { done = Number(localStorage.getItem("cobblerTourDone")) || 0; } catch {}
    box.replaceChildren(
      el("p", {}, `A guided walk through every page in ${STEPS.length} short stops: what each page is for, how to use it, and the shortcuts people miss. It only points at things; your work isn't touched. Takes about ten minutes, and you can leave and come back.`),
      el("div", { class: "help-downloads" },
        el("button", { type: "button", class: "small-btn", onclick: () => start(0) }, state ? "Restart the tour" : done ? "Take the tour again" : "Start the tour"),
        state && el("button", { type: "button", class: "small-btn", onclick: () => goTo(state.step) }, `Continue (stop ${state.step + 1} of ${STEPS.length})`),
        el("a", { class: "small-btn", href: "../resources/docs/user-guide.pdf", download: "Cobbler Project - How to use the app.pdf" }, "The written guide (PDF)")),
      done ? el("p", { class: "media-muted" }, `You finished the tour on ${Cobbler.formatDate(done)}.`) : null);
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderPanel();
    $("tour-start")?.addEventListener("click", () => start(0));
    // A tour in progress carries on here (a moment after the page has settled)
    if (state) setTimeout(show, 400);
  });
  document.addEventListener("projects-refresh", () => { if (state) place(); });

  window.CobblerTour = { start, stop, goTo, steps: STEPS, state: () => state && { ...state } };
})();
