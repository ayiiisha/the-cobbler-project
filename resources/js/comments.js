/* =========================================================
   comments.js — comments on every page
   ---------------------------------------------------------
   Two parts:
     1. Comment threads (list, reply, edit, resolve, delete).
        Any page can show threads in any box with:
          CobblerComments.mount(container, { getThreads, save, ... })
        The Zine Planner's Critique tab uses this for file comments.
     2. The sitewide Comments drawer: a speech-bubble button
        (bottom right, above the "+") opens a panel for comments
        about the page you're on. Select text on the page first
        to quote it in your comment.

   Page comments are saved inside the active project, under the
   key "comments", grouped by page:
     project.data.comments = { "zine-planner": [thread, ...], ... }

   A thread looks like:
     { id, author, text, created, edited, resolved, quote, anchor, assignee,
       replies: [{ id, author, text, created, edited }] }
     assignee = the name of a Team member it's assigned to (their
              open comments show under "My tasks" on the Team page)
     quote  = text quoted from the page
     anchor = where the comment points, e.g. a pin on an image
              { x: 40.5, y: 12 }, a PDF page { page: 3 } or a
              moment in a video { time: 42.1 }

   Your name (shown on comments) is saved in this browser and
   used in every project.

   Needs projects-core.js loaded first.
   ========================================================= */
(() => {

  /* ---------- Safety check: the Projects API must exist ---------- */
  if (!window.Projects) {
    console.error("comments.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }


  /* ---------- Settings ---------- */

  const DATA_KEY = "comments";          // where page comments live inside the project
  const AUTHOR_KEY = "commentAuthor";   // your name, saved in this browser

  // This page's name in the comments data, e.g. "zine-planner"
  const PAGE_KEY = location.pathname.split("/").pop().replace(/\.html?$/i, "") || "index";


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  // A unique id for a comment, e.g. "clx4k2m9ab"
  const newId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* Builds an element. Text children are always added as plain text,
     so nothing typed into a comment can inject code into the page.
       el("button", { class: "small-btn", onclick: fn }, "Reply") */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false));
    return node;
  }

  // "8 Oct 2026, 22:10"
  const formatTime = (ms) => new Date(ms).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });

  // Shortens long text with … (for buttons and labels)
  const shorten = (text, max) => text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;

  // Collapses runs of spaces/new lines so quotes can be found on the page
  const squash = (text) => text.replace(/\s+/g, " ").trim();


  /* ---------- Your name ---------- */

  const getAuthor = () => { try { return localStorage.getItem(AUTHOR_KEY) || ""; } catch { return ""; } };
  const setAuthor = (name) => { try { localStorage.setItem(AUTHOR_KEY, name.trim()); } catch {} };
  const authorName = () => getAuthor() || "Anonymous";

  /* A "Your name" field that saves as you type. Every copy on the
     page stays in sync, so the name only needs typing once. */
  function authorField() {
    const input = el("input", {
      class: "comment-author-input", maxlength: "60", autocomplete: "name", placeholder: "Anonymous",
    });
    input.value = getAuthor();
    input.addEventListener("input", () => {
      setAuthor(input.value);
      document.querySelectorAll(".comment-author-input").forEach(other => {
        if (other !== input) other.value = input.value;
      });
    });
    return el("label", { class: "comment-author-field" }, "Your name", input);
  }


  /* ---------- New comments and replies ---------- */

  // `extra` adds fields such as { quote } or { anchor }
  function createThread(text, extra = {}) {
    return {
      id: newId(), author: authorName(), text: text.trim(), created: Date.now(),
      resolved: false, replies: [], ...extra,
    };
  }

  const createReply = (text) => ({ id: newId(), author: authorName(), text: text.trim(), created: Date.now() });

  // Ctrl/Cmd + Enter sends the form a textarea sits in
  function submitOnCtrlEnter(textarea) {
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        textarea.form?.requestSubmit();
      }
    });
  }


  /* =========================================================
     1. COMMENT THREADS
     ---------------------------------------------------------
     CobblerComments.mount(container, options) draws a list of
     threads and handles reply / edit / resolve / delete.

     options:
       getThreads()        → the array of threads (changed in place)
       save()              → called after every change
       showResolved()      → true to list resolved threads too (default: true)
       emptyText           → shown when there are no comments
       label(thread)       → optional chip text, e.g. "#2" or "p. 3"
       onLabelClick(thread)→ what clicking that chip does
       onQuoteClick(thread)→ what clicking a quote does
       onSelect(thread)    → a thread was clicked
       onChange()          → after any change (e.g. redraw pins)

     Returns { render(), select(id) }.
     ========================================================= */
  function mount(container, options) {
    const opts = {
      showResolved: () => true,
      emptyText: "No comments yet.",
      ...options,
    };

    // What's open right now (kept when the list is redrawn)
    let selectedId = null;
    let editing = null;      // id of the comment or reply being edited
    let replyingTo = null;   // id of the thread with an open reply box

    /* Save, redraw, and tell the page */
    function commit() {
      opts.save();
      render();
      opts.onChange?.();
    }

    /* A small text form used for edits and replies */
    function textForm({ value = "", submitLabel, placeholder, onSubmit, onCancel }) {
      const textarea = el("textarea", { rows: "3", required: true, placeholder, "aria-label": placeholder || submitLabel });
      textarea.value = value;
      submitOnCtrlEnter(textarea);
      const form = el("form", { class: "comment-inline-form" },
        textarea,
        el("div", { class: "comment-actions" },
          el("button", { type: "submit", class: "small-btn" }, submitLabel),
          el("button", { type: "button", class: "small-btn", onclick: onCancel }, "Cancel")));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (textarea.value.trim()) onSubmit(textarea.value.trim());
      });
      requestAnimationFrame(() => textarea.focus());
      return form;
    }

    /* The text of a comment or reply, or its edit form */
    function bodyOf(item) {
      if (editing === item.id) {
        return textForm({
          value: item.text,
          submitLabel: "Save",
          onSubmit: (text) => { item.text = text; item.edited = Date.now(); editing = null; commit(); },
          onCancel: () => { editing = null; render(); },
        });
      }
      return el("p", { class: "comment-text" }, item.text,
        item.edited && el("span", { class: "comment-edited" }, " (edited)"));
    }

    /* Name and time line */
    const headOf = (item, ...extras) =>
      el("div", { class: "comment-head" },
        ...extras,
        el("strong", { class: "comment-author" }, item.author || "Anonymous"),
        el("time", { class: "comment-time", datetime: new Date(item.created).toISOString() }, formatTime(item.created)));

    /* One thread: the comment, its replies and its buttons */
    function threadView(thread, threads) {
      const label = opts.label?.(thread);
      const labelChip = label && (opts.onLabelClick
        ? el("button", { type: "button", class: "comment-label", title: "Show where this points",
                         onclick: () => opts.onLabelClick(thread) }, label)
        : el("span", { class: "comment-label" }, label));

      const quote = thread.quote && (opts.onQuoteClick
        ? el("button", { type: "button", class: "comment-quote", title: "Find this on the page",
                         onclick: () => opts.onQuoteClick(thread) }, thread.quote)
        : el("blockquote", { class: "comment-quote" }, thread.quote));

      const replies = (thread.replies || []).map(reply =>
        el("li", { class: "comment-reply" },
          headOf(reply),
          bodyOf(reply),
          editing !== reply.id && el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "comment-action", onclick: () => { editing = reply.id; render(); } }, "Edit"),
            el("button", { type: "button", class: "comment-action", onclick: () => {
              if (!confirm("Delete this reply?")) return;
              thread.replies = thread.replies.filter(r => r !== reply);
              commit();
            } }, "Delete"))));

      // Assign to a team member (page comments only)
      const people = opts.assignees?.() || [];
      const assign = opts.assignees && el("select", { class: "comment-assign", "aria-label": "Assign to" },
        el("option", { value: "" }, thread.assignee ? "Unassign" : "Assign to…"),
        [...new Set([...people, thread.assignee].filter(Boolean))].map(n => el("option", { value: n }, n)));
      if (assign) {
        assign.value = thread.assignee || "";
        assign.addEventListener("change", () => {
          if (assign.value) thread.assignee = assign.value; else delete thread.assignee;
          thread.updated = Date.now();
          commit();
        });
      }

      const actions = editing !== thread.id && el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "comment-action", onclick: () => { replyingTo = thread.id; render(); } }, "Reply"),
        el("button", { type: "button", class: "comment-action", onclick: () => { editing = thread.id; render(); } }, "Edit"),
        el("button", { type: "button", class: "comment-action", onclick: () => {
          thread.resolved = !thread.resolved;
          commit();
        } }, thread.resolved ? "Reopen" : "Resolve"),
        el("button", { type: "button", class: "comment-action", onclick: () => {
          const count = (thread.replies || []).length;
          if (!confirm(count ? `Delete this comment and its ${count} ${count === 1 ? "reply" : "replies"}?` : "Delete this comment?")) return;
          threads.splice(threads.indexOf(thread), 1);
          commit();
        } }, "Delete"),
        assign);

      const replyForm = replyingTo === thread.id && textForm({
        submitLabel: "Reply",
        placeholder: "Write a reply",
        onSubmit: (text) => {
          (thread.replies ||= []).push(createReply(text));
          replyingTo = null;
          commit();
        },
        onCancel: () => { replyingTo = null; render(); },
      });

      const item = el("li", {
        class: ["comment-thread", thread.resolved && "is-resolved", thread.id === selectedId && "is-selected"]
          .filter(Boolean).join(" "),
        dataset: { id: thread.id },
      },
        headOf(thread, labelChip, thread.resolved && el("span", { class: "comment-badge" }, "Resolved"),
          thread.assignee && el("span", { class: "comment-badge comment-assignee" }, `For ${thread.assignee}`)),
        quote,
        bodyOf(thread),
        actions,
        replies.length > 0 && el("ol", { class: "comment-replies" }, replies),
        replyForm);

      // Clicking the thread itself (not a button or form) selects it
      item.addEventListener("click", (event) => {
        if (event.target.closest("button, a, form, textarea, input")) return;
        markSelected(thread.id);
        opts.onSelect?.(thread);
      });
      return item;
    }

    /* Highlights one thread without redrawing (keeps open forms) */
    function markSelected(id) {
      selectedId = id;
      container.querySelectorAll(".comment-thread").forEach(node =>
        node.classList.toggle("is-selected", node.dataset.id === id));
    }

    /* Draws the whole list */
    function render() {
      const threads = opts.getThreads();
      const visible = threads.filter(t => opts.showResolved() || !t.resolved);
      container.replaceChildren();

      if (!visible.length) {
        container.append(el("p", { class: "comment-empty" },
          threads.length ? "Every comment here is resolved." : opts.emptyText));
        return;
      }
      container.append(el("ol", { class: "comment-list" }, visible.map(t => threadView(t, threads))));
    }

    /* Selects a thread from outside (e.g. clicking a pin) and scrolls to it */
    function select(id) {
      markSelected(id);
      const node = [...container.querySelectorAll(".comment-thread")].find(n => n.dataset.id === id);
      node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    render();
    return { render, select, selectedId: () => selectedId };
  }


  /* =========================================================
     2. SITEWIDE COMMENTS DRAWER
     ========================================================= */

  /* ---------- Page comment data ---------- */

  function loadStore() {
    const value = Projects.getData(DATA_KEY, {});
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  let store = loadStore();

  // The thread list for one page (created when first needed)
  const threadsFor = (key) => (store[key] ||= []);

  // Saves, dropping pages with no comments left
  function saveStore() {
    for (const key of Object.keys(store)) if (!Array.isArray(store[key]) || !store[key].length) delete store[key];
    Projects.setData(DATA_KEY, store);
    updateCount();
    document.dispatchEvent(new Event("comments-changed"));   // e.g. the Team page's task lists
  }

  // Team members' names (from the Team page), for assigning comments
  function teamNames() {
    const team = Projects.getData("team", []);
    return Array.isArray(team) ? team.map(m => (m.name || "").trim()).filter(Boolean) : [];
  }

  /* Adds threads to a page's comments from another script (e.g. Resolve markers) */
  function addPageComments(key, threads) {
    store = loadStore();
    threadsFor(key).push(...threads);
    saveStore();
    if (isOpen()) renderList();
  }

  // A page's name as shown in the sidebar, e.g. "Zine Planner"
  function pageTitle(key) {
    const link = document.querySelector(`.nav-links a[href="${CSS.escape(key)}.html"]`);
    return link?.textContent || key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }


  /* ---------- Find quoted text on the page ---------- */

  /* Walks down from <main> to the smallest element that still
     contains the quote, scrolls to it and flashes it. */
  function locateQuote(thread) {
    const target = squash(thread.quote || "");
    let node = document.querySelector("main") || document.body;
    if (!target || !squash(node.textContent).includes(target)) {
      setStatus("That text isn't on this page any more.");
      return;
    }
    for (;;) {
      const child = [...node.children].find(c => squash(c.textContent).includes(target));
      if (!child) break;
      node = child;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    node.classList.remove("comment-flash");
    void node.offsetWidth;   // restart the animation if it's already running
    node.classList.add("comment-flash");
    setTimeout(() => node.classList.remove("comment-flash"), 2200);
  }


  /* ---------- HTML template ---------- */

  const drawerTemplate = `
    <button type="button" class="fab comments-fab" id="comments-fab"
            aria-controls="comments-drawer" aria-expanded="false" title="Comments">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <span class="visually-hidden" id="comments-fab-label">Comments</span>
      <span class="comments-count" id="comments-count" aria-hidden="true" hidden></span>
    </button>

    <aside class="comments-drawer" id="comments-drawer" aria-labelledby="comments-title" hidden>
      <div class="panel-head">
        <div>
          <h2 id="comments-title">Comments</h2>
          <p class="comments-project">in <strong id="comments-project-name"></strong></p>
        </div>
        <button type="button" class="panel-close" id="comments-close" aria-label="Close comments">×</button>
      </div>

      <div class="comments-scope" role="group" aria-label="Show comments for">
        <button type="button" data-scope="page" aria-pressed="true">This page</button>
        <button type="button" data-scope="all" aria-pressed="false">All pages in project</button>
      </div>

      <form class="comment-form" id="comments-form">
        <div id="comments-author-slot"></div>

        <div class="comment-quote-draft" id="comments-quote-draft" hidden>
          <blockquote class="comment-quote" id="comments-quote-text"></blockquote>
          <button type="button" class="panel-close" id="comments-quote-remove" aria-label="Remove quote">×</button>
        </div>

        <label for="comments-text">Comment on this page</label>
        <textarea id="comments-text" rows="3" required
                  placeholder="Select text on the page first to quote it"></textarea>

        <label class="comment-assign-field" id="comments-assign-field">Assign to (optional)
          <select id="comments-assign"></select>
        </label>

        <div class="comment-actions">
          <button type="submit" class="small-btn">Comment</button>
          <button type="button" class="small-btn" id="comments-use-selection" hidden></button>
        </div>
      </form>

      <label class="comments-check">
        <input type="checkbox" id="comments-show-resolved"> Show resolved
      </label>

      <p class="panel-status" id="comments-status" role="status"></p>
      <div id="comments-threads"></div>
    </aside>
  `;


  /* ---------- Drawer state ---------- */

  const $ = (id) => document.getElementById(id);
  let scope = "page";         // "page" or "all"
  let draftQuote = "";        // quote attached to the comment being written
  let lastSelection = "";     // most recent text selected on the page
  let statusTimer = 0;

  const isOpen = () => !$("comments-drawer").hidden;
  const showResolved = () => $("comments-show-resolved").checked;

  function setStatus(message) {
    $("comments-status").textContent = message;
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(() => { $("comments-status").textContent = ""; }, 5000);
  }

  /* Number of open comments on this page, shown on the button */
  function updateCount() {
    const open = (store[PAGE_KEY] || []).filter(t => !t.resolved).length;
    const badge = $("comments-count");
    badge.hidden = !open;
    badge.textContent = open > 99 ? "99+" : String(open);
    $("comments-fab-label").textContent = open ? `Comments (${open} open)` : "Comments";
  }


  /* ---------- Quoting selected text ---------- */

  function setDraftQuote(text) {
    draftQuote = text;
    $("comments-quote-draft").hidden = !text;
    $("comments-quote-text").textContent = text;
    updateQuoteButton();
  }

  function updateQuoteButton() {
    const button = $("comments-use-selection");
    button.hidden = !lastSelection || lastSelection === draftQuote || scope !== "page";
    button.textContent = `Quote “${shorten(lastSelection, 28)}”`;
  }

  // Text currently selected on the page (not inside the drawer or a text field)
  function pageSelection() {
    const selection = window.getSelection();
    const text = selection ? squash(selection.toString()) : "";
    if (!text || !selection.anchorNode) return "";
    if ($("comments-drawer").contains(selection.anchorNode)) return "";
    if (document.activeElement?.matches("input, textarea")) return "";
    return shorten(text, 500);
  }


  /* ---------- Draw the drawer's list ---------- */

  let pageThreads = null;   // the mounted list for "This page"

  function renderList() {
    const box = $("comments-threads");
    box.replaceChildren();
    $("comments-form").hidden = scope !== "page";
    document.querySelectorAll(".comments-scope [data-scope]").forEach(b =>
      b.setAttribute("aria-pressed", String(b.dataset.scope === scope)));
    updateQuoteButton();

    // This page only
    if (scope === "page") {
      pageThreads = mount(box, {
        getThreads: () => threadsFor(PAGE_KEY),
        save: saveStore,
        showResolved,
        assignees: teamNames,
        emptyText: "No comments on this page yet.",
        onQuoteClick: locateQuote,
      });
      return;
    }

    // Every page in this project, this page first
    const keys = Object.keys(store).filter(k => store[k].length)
      .sort((a, b) => (b === PAGE_KEY) - (a === PAGE_KEY) || pageTitle(a).localeCompare(pageTitle(b)));
    if (!keys.length) {
      box.append(el("p", { class: "comment-empty" }, `No comments in “${Projects.activeName()}” yet.`));
      return;
    }
    keys.forEach(key => {
      const list = el("div");
      box.append(el("section", { class: "comments-page-group" },
        el("h3", {}, key === PAGE_KEY
          ? `${pageTitle(key)} (this page)`
          : el("a", { href: `${key}.html` }, pageTitle(key))),
        list));
      mount(list, {
        getThreads: () => store[key] || [],
        save: saveStore,
        showResolved,
        assignees: teamNames,
        onQuoteClick: key === PAGE_KEY ? locateQuote : null,
      });
    });
  }


  /* ---------- Open / close ---------- */

  function open() {
    store = loadStore();   // pick up changes made in another tab
    $("comments-project-name").textContent = Projects.activeName();
    const people = teamNames();
    $("comments-assign-field").hidden = !people.length;
    $("comments-assign").replaceChildren(el("option", { value: "" }, "No one"), ...people.map(n => el("option", { value: n }, n)));
    $("comments-drawer").hidden = false;
    $("comments-fab").setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("comments-open");
    renderList();
    if (scope === "page") $("comments-text").focus();
  }

  function close() {
    $("comments-drawer").hidden = true;
    $("comments-fab").setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("comments-open");
    $("comments-fab").focus();
  }


  /* ---------- Build and wire up ---------- */

  function setUpDrawer() {
    document.body.insertAdjacentHTML("beforeend", drawerTemplate);
    $("comments-author-slot").replaceWith(authorField());
    submitOnCtrlEnter($("comments-text"));

    // The button: grab any selected text first (clicking can clear it), then open/close
    let selectedAtPress = "";
    $("comments-fab").addEventListener("pointerdown", () => { selectedAtPress = pageSelection(); });
    $("comments-fab").addEventListener("click", () => {
      if (isOpen()) { close(); return; }
      const selected = selectedAtPress || pageSelection();
      selectedAtPress = "";
      if (selected) setDraftQuote(selected);
      open();
    });
    $("comments-close").addEventListener("click", close);

    // Esc closes the drawer (unless a dialog or menu is handling it)
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen() || event.defaultPrevented) return;
      if (document.querySelector("dialog[open], :popover-open")) return;
      close();
    });

    // This page / All pages
    document.querySelectorAll(".comments-scope [data-scope]").forEach(button =>
      button.addEventListener("click", () => { scope = button.dataset.scope; renderList(); }));

    $("comments-show-resolved").addEventListener("change", renderList);

    // Remember the latest text selected on the page, for the "Quote" button
    document.addEventListener("selectionchange", () => {
      const text = pageSelection();
      if (!text) return;
      lastSelection = text;
      if (isOpen()) updateQuoteButton();
    });
    $("comments-use-selection").addEventListener("click", () => {
      setDraftQuote(lastSelection);
      $("comments-text").focus();
    });
    $("comments-quote-remove").addEventListener("click", () => setDraftQuote(""));

    // Post a new comment on this page
    $("comments-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const text = $("comments-text").value.trim();
      if (!text) return;
      const assignee = $("comments-assign").value;
      threadsFor(PAGE_KEY).push(createThread(text, { ...(draftQuote ? { quote: draftQuote } : {}), ...(assignee ? { assignee } : {}) }));
      $("comments-assign").value = "";
      saveStore();
      $("comments-text").value = "";
      setDraftQuote("");
      pageThreads?.render();
      setStatus("Comment added.");
    });

    // Keep the project name current if it's renamed while the drawer is open
    document.addEventListener("projects-changed", () => {
      $("comments-project-name").textContent = Projects.activeName();
    });

    updateCount();
  }

  document.addEventListener("DOMContentLoaded", setUpDrawer);


  /* ---------- Let other scripts use the comment threads ---------- */
  window.CobblerComments = { mount, createThread, authorField, authorName, formatTime, submitOnCtrlEnter, addPageComments, PAGE_KEY };
})();
