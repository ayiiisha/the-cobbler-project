/* =========================================================
   search.js — search across the whole project, from the sidebar
   ---------------------------------------------------------
   A search box under the Projects button, on every page. It looks
   through everything saved in the active project (notes, ideas,
   tasks, people, questions, pitches, packages, transcripts, paper
   edits, storyboards, zines, drafts, scripts, songs, shot lists,
   resources, comments…) and lists what matches, grouped by page,
   with a snippet. Each result is a link to its page (and, where
   the page can open an item from the address, straight to it).

   Ctrl+K (⌘K) jumps to the box; Esc clears it. Results update as
   you type. Transcripts kept outside the project (in file storage
   or a folder) are searched by their titles only.

   Needs projects-core.js. Loads on every page (boot.js).
   ========================================================= */
(() => {

  if (!window.Projects) return;

  const { el, $ } = Cobbler;

  /* Where each kind of saved data lives, and how to open one item there */
  const PAGES = {
    tracker:        { name: "Project Tracker", href: () => "project-tracker.html" },
    team:           { name: "Team",            href: () => "team.html" },
    tasks:          { name: "Tasks",           href: () => "team.html#tasks" },
    research:       { name: "Research",        href: () => "research.html" },
    interviewees:   { name: "Interviews",      href: () => "interviews.html" },
    questions:      { name: "Question bank",   href: () => "interviews.html#questions" },
    pitches:        { name: "Pitches",         href: () => "pitches.html" },
    packaging:      { name: "Packaging",       href: () => "packaging.html" },
    ideas:          { name: "Ideas",           href: () => "ideas.html" },
    calendarEvents: { name: "Calendar",        href: () => "calendar.html" },
    media:          { name: "Media & Transcripts", href: () => "media-and-transcripts.html" },
    edits:          { name: "Text Edit",       href: () => "media-and-transcripts.html#edit" },
    storyboards:    { name: "Storyboarder",    href: (item, path, top) => top?.id ? `storyboarder.html#board=${encodeURIComponent(top.id)}` : "storyboarder.html" },
    zines:          { name: "Zine Planner",    href: (item, path, top) => top?.id ? `zine-planner.html#zine=${encodeURIComponent(top.id)}` : "zine-planner.html" },
    datasets:       { name: "Data Analysis",   href: () => "data-analysis.html" },
    resources:      { name: "Resources",       href: () => "resources.html" },
    comments:       { name: "Comments",        href: (item, path) => `${path[1] || "index"}.html` },
    drafts:         { name: "Writing",         href: () => "writing.html" },
    storyBible:     { name: "Story bible",     href: () => "writing.html#story" },
    sourceLog:      { name: "Sources",         href: () => "writing.html#reporting" },
    recordsRequests:{ name: "Records requests", href: () => "writing.html#reporting" },
    eventTimeline:  { name: "Event timeline",  href: () => "writing.html#reporting" },
    submissions:    { name: "Submissions",     href: () => "writing.html#business" },
    corrections:    { name: "Corrections",     href: () => "writing.html#revisions" },
    screenplays:    { name: "Screenplay",      href: () => "screenplay.html" },
    songs:          { name: "Songs",           href: () => "music.html" },
    gigs:           { name: "Gigs",            href: () => "music.html#gigs" },
    releases:       { name: "Releases",        href: () => "music.html#releases" },
    samples:        { name: "Sample clearances", href: () => "music.html#samples" },
    shotLists:      { name: "Shot List",       href: (item, path, top) => top?.id ? `shot-list.html#list=${encodeURIComponent(top.id)}` : "shot-list.html" },
  };

  // Fields that name an item, in order of preference
  const TITLE_FIELDS = ["title", "name", "headline", "question", "label", "subject", "heading", "text", "description", "notes"];
  // Fields never worth searching (ids, dates, settings, pointers to files)
  const SKIP = /^(id|_mt|_mb|_id|created|updated|added|at|date|time|color|colour|column|stage|status|kind|type|aspect|fps|size|blob|key|image|storage|storageLog|strokes|texts|paths|points|href|url|link|shareId|by|who|uid|seconds|duration|minutes|x|y|w|h|page|order|index|version|done|archived|readOnly|hash)$/;
  const MAX_PER_PAGE = 12;
  const MAX_TOTAL = 60;


  /* =========================================================
     FINDING MATCHES
     ========================================================= */

  const titleOf = (item) => {
    if (!item || typeof item !== "object") return "";
    for (const f of TITLE_FIELDS) if (typeof item[f] === "string" && item[f].trim()) return item[f].trim().split("\n")[0].slice(0, 80);
    return "";
  };

  /* Walks the project's data; calls found(key, item, field, text) for every string that matches */
  function search(data, needle) {
    const q = needle.toLowerCase();
    const hits = [];
    const seen = new Set();
    const visit = (value, key, path, item, top) => {
      if (hits.length >= MAX_TOTAL * 3) return;
      if (typeof value === "string") {
        if (value.length < q.length || !value.toLowerCase().includes(q)) return;
        const owner = item || { id: `${key}:${path.join("/")}` };
        const sig = `${key}|${owner.id ?? path.join("/")}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        hits.push({ key, item: owner, top: top || owner, path, field: path[path.length - 1], text: value });
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => visit(v, key, [...path, i], item, top));
      } else if (value && typeof value === "object") {
        // An object with an id (or a title-like field) is "an item": results point at it
        const isItem = value.id != null || TITLE_FIELDS.some(f => typeof value[f] === "string");
        const owner = isItem ? value : item;
        const outermost = top || (isItem ? value : null);   // the list, board or zine a nested item belongs to
        for (const [k, v] of Object.entries(value)) {
          if (SKIP.test(k)) continue;
          if (typeof v === "string" && (k === "id" || /^[a-z]\w*[0-9a-z]{6,}$/.test(v) && v.length < 20 && !v.includes(" "))) continue;   // ids and refs
          visit(v, key, [...path, k], owner, outermost);
        }
      }
    };
    for (const [key, value] of Object.entries(data || {})) {
      if (key.startsWith("_") || !PAGES[key]) continue;
      visit(value, key, [key], null, null);
    }
    return hits;
  }

  /* "…a few words either side of the match…", with the match wrapped in <mark> */
  function snippet(text, needle) {
    const flat = text.replace(/\s+/g, " ");
    const at = flat.toLowerCase().indexOf(needle.toLowerCase());
    if (at < 0) return el("span", { class: "site-search-snippet" }, flat.slice(0, 100));
    const start = Math.max(0, at - 45);
    const end = Math.min(flat.length, at + needle.length + 60);
    return el("span", { class: "site-search-snippet" },
      start > 0 ? "…" : "", flat.slice(start, at), el("mark", {}, flat.slice(at, at + needle.length)), flat.slice(at + needle.length, end), end < flat.length ? "…" : "");
  }

  /* A title with the match marked, when it's in there */
  function highlight(text, needle) {
    const at = text.toLowerCase().indexOf(needle.toLowerCase());
    if (at < 0) return [text];
    return [text.slice(0, at), el("mark", {}, text.slice(at, at + needle.length)), text.slice(at + needle.length)];
  }


  /* =========================================================
     THE BOX AND THE RESULTS
     ========================================================= */

  const template = `
    <form class="site-search" role="search" id="site-search">
      <label class="visually-hidden" for="site-search-input">Search this project</label>
      <input type="search" id="site-search-input" placeholder="Search this project" autocomplete="off" spellcheck="false"
             aria-describedby="site-search-hint" aria-controls="site-search-results" aria-expanded="false">
      <span class="visually-hidden" id="site-search-hint">Ctrl+K or ⌘K jumps here. Results appear below as you type.</span>
      <div id="site-search-results" class="site-search-results" aria-live="polite" hidden></div>
    </form>
  `;

  let timer = 0;

  function render(needle) {
    const box = $("site-search-results");
    const input = $("site-search-input");
    const q = needle.trim();
    if (q.length < 2) { box.hidden = true; box.replaceChildren(); input.setAttribute("aria-expanded", "false"); return; }
    const data = Projects.peek?.() || Projects.snapshot?.(Projects.activeId()) || {};   // read only, never changed
    const hits = search(data, q);
    const groups = new Map();
    for (const hit of hits) {
      const list = groups.get(hit.key) || [];
      if (list.length < MAX_PER_PAGE) list.push(hit);
      groups.set(hit.key, list);
    }
    const total = [...groups.values()].reduce((n, l) => n + l.length, 0);
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (!total) {
      box.replaceChildren(el("p", { class: "site-search-empty" }, `Nothing in “${Projects.activeName()}” matches “${q}”.`));
      return;
    }
    const here = location.pathname.split("/").pop();
    box.replaceChildren(
      el("p", { class: "site-search-count" }, `${total}${hits.length > total ? "+" : ""} match${total === 1 ? "" : "es"} in “${Projects.activeName()}”`),
      ...[...groups.entries()].map(([key, list]) => el("section", { class: "site-search-group" },
        el("h3", {}, PAGES[key].name),
        el("ul", {}, list.map(hit => {
          const href = PAGES[key].href(hit.item, hit.path, hit.top);
          const title = titleOf(hit.item) || PAGES[key].name;
          const samePage = href.split("#")[0] === here;
          const inTitle = hit.text.trim().split("\n")[0].slice(0, 80) === title;
          return el("li", {}, el("a", { href, class: "site-search-hit", onclick: samePage && href.includes("#") ? () => { location.hash = href.split("#")[1]; } : null },
            el("span", { class: "site-search-title" }, ...highlight(title, q)),
            inTitle && hit.text.trim().length <= 80 ? null : snippet(hit.text, q)));
        })))));
  }

  function clear() {
    const input = $("site-search-input");
    if (!input) return;
    input.value = "";
    render("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    if ($("site-search")) return;
    const anchor = $("project-button") || document.querySelector(".main-header .text-box");
    if (!anchor) return;   // a page without the sidebar
    anchor.insertAdjacentHTML("afterend", template);
    const input = $("site-search-input");
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => render(input.value), 150); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); if (input.value) clear(); else input.blur(); }
      if (event.key === "ArrowDown") { const first = $("site-search-results").querySelector("a"); if (first) { event.preventDefault(); first.focus(); } }
    });
    $("site-search").addEventListener("submit", (event) => { event.preventDefault(); render(input.value); $("site-search-results").querySelector("a")?.focus(); });
    $("site-search-results").addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const links = [...$("site-search-results").querySelectorAll("a")];
      const i = links.indexOf(document.activeElement);
      if (i < 0) return;
      event.preventDefault();
      if (event.key === "ArrowUp" && i === 0) input.focus();
      else links[Math.min(links.length - 1, Math.max(0, i + (event.key === "ArrowDown" ? 1 : -1)))].focus();
    });
    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.documentElement.classList.add("nav-open");
        input.focus();
        input.select();
      }
    });
    // Fresh results when the data changes (another tab, an undo, a project switch)
    document.addEventListener("projects-refresh", () => { if (input.value.trim().length >= 2) render(input.value); });
    document.addEventListener("projects-data-changed", () => { if (input.value.trim().length >= 2) render(input.value); });
  });

  window.CobblerSearch = { search, titleOf, PAGES };
})();
