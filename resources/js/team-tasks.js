/* =========================================================
   team-tasks.js — Tasks and Credits on the Team page
   ---------------------------------------------------------
   TASKS: jobs given to people on the team, saved inside the
   project:
     project.data.tasks = [{ id, text, assignee, due: "2026-10-20", done, created, updated }]
   assignee is a team member's name. Comments assigned to someone
   (comments.js, thread.assignee) are listed with their tasks.
   "Everyone" groups the project's tasks by person; "My tasks"
   shows yours ("I am" is remembered in this browser), in this
   project or every project. Due dates show on the Calendar.

   CREDITS: end credits built from the team's roles (and the
   people filmed, from Interviews) as text to paste into a
   DaVinci Resolve title, or as images: cards (1920 × 1080 etc.)
   or one tall scrolling roll. Transparent PNGs sit on top of
   the video on a track above it.

   Needs projects-core.js, team.js (window.TeamPage) and zip.js.
   ========================================================= */
(() => {

  if (!window.Projects) return;
  const $ = (id) => document.getElementById(id);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  const newId = () => "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = (n) => String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "credits";
  const fmtDue = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short" }); };

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // A page's name as the sidebar shows it, e.g. "zine-planner" → "Zine Planner"
  const pageTitle = (key) => document.querySelector(`.nav-links a[href="${CSS.escape(key)}.html"]`)?.textContent
    || key.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());


  /* =========================================================
     TASKS
     ========================================================= */

  const ME_KEY = "cobblerMe";
  const VIEW_KEY = "teamTasksView";
  const view = (() => {
    try { return { mode: "everyone", all: false, done: false, ...JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") }; }
    catch { return { mode: "everyone", all: false, done: false }; }
  })();
  const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {} };

  const me = () => {
    try { return localStorage.getItem(ME_KEY) || localStorage.getItem("commentAuthor") || ""; } catch { return ""; }
  };
  const setMe = (name) => { try { localStorage.setItem(ME_KEY, name); } catch {} };

  const tasksOf = (pid) => { const v = Projects.getDataFor(pid, "tasks", []); return Array.isArray(v) ? v : []; };
  const saveTasks = (pid, list) => Projects.setDataFor(pid, "tasks", list);

  // Comments assigned to someone: [{ page, thread }]
  function assignedComments(pid) {
    const store = Projects.getDataFor(pid, "comments", {}) || {};
    return Object.entries(store).flatMap(([page, threads]) =>
      (Array.isArray(threads) ? threads : []).filter(t => t.assignee).map(thread => ({ page, thread })));
  }
  function saveComment(pid) {
    // The thread objects were read from the project, so saving the store keeps the change
    Projects.setDataFor(pid, "comments", Projects.getDataFor(pid, "comments", {}));
  }

  let lists = new Map();   // project id → its task list, as drawn

  function taskRow(pid, task, names, { showAssignee = true } = {}) {
    const list = lists.get(pid);
    const commit = (redraw = false) => { task.updated = Date.now(); saveTasks(pid, list); if (redraw) render(); };

    const done = el("input", { type: "checkbox", checked: !!task.done, "aria-label": `Done: ${task.text || "task"}` });
    done.addEventListener("change", () => { task.done = done.checked; commit(true); });
    const text = el("input", { class: "task-text", value: task.text, placeholder: "What needs doing?", "aria-label": "Task" });
    text.addEventListener("input", () => { task.text = text.value; commit(); });
    text.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addTask(pid, task.assignee, list.indexOf(task) + 1);
    });
    const who = el("select", { class: "team-select task-assignee", "aria-label": "Assigned to" },
      el("option", { value: "" }, "Unassigned"),
      [...new Set([...names, task.assignee].filter(Boolean))].map(n => el("option", { value: n }, n)));
    who.value = task.assignee || "";
    who.addEventListener("change", () => { task.assignee = who.value; commit(true); });
    const due = el("input", { type: "date", class: "task-due", value: task.due || "", "aria-label": "Due" });
    due.addEventListener("change", () => { task.due = due.value; commit(true); });
    const overdue = !task.done && task.due && task.due < today();

    return el("li", { class: `task-row${task.done ? " is-done" : ""}${overdue ? " is-overdue" : ""}`, dataset: { id: task.id } },
      done, text,
      showAssignee && who,
      due,
      overdue && el("span", { class: "task-flag" }, "Overdue"),
      el("button", { type: "button", class: "goal-item-remove task-remove", "aria-label": `Delete task ${task.text}`, onclick: () => {
        list.splice(list.indexOf(task), 1);
        saveTasks(pid, list);
        render();
      } }, "×"));
  }

  function commentRow(pid, { page, thread }) {
    return el("li", { class: `task-row task-row--comment${thread.resolved ? " is-done" : ""}` },
      el("input", { type: "checkbox", checked: !!thread.resolved, "aria-label": "Resolved", onchange: (event) => {
        thread.resolved = event.target.checked;
        saveComment(pid);
        render();
      } }),
      el("span", { class: "task-comment" },
        el("span", { class: "task-comment-where" }, "Comment on ", el("a", { href: `${page}.html` }, pageTitle(page)),
          thread.author ? ` from ${thread.author}` : ""),
        el("span", {}, thread.text.length > 160 ? thread.text.slice(0, 159) + "…" : thread.text)));
  }

  function addTask(pid, assignee = "", at = null) {
    const list = lists.get(pid) || tasksOf(pid);
    const task = { id: newId(), text: "", assignee: assignee || "", due: "", done: false, created: Date.now(), updated: Date.now() };
    list.splice(at ?? list.length, 0, task);
    saveTasks(pid, list);
    render();
    document.querySelector(`.task-row[data-id="${task.id}"] .task-text`)?.focus();
  }

  function render() {
    if (!window.TeamPage) return;
    const pid = TeamPage.projectId();
    const names = TeamPage.team().map(m => m.name.trim()).filter(Boolean);

    // Controls
    document.querySelectorAll("[data-tasks-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tasksView === view.mode)));
    const meSelect = $("tasks-me");
    const myName = me();
    meSelect.replaceChildren(el("option", { value: "" }, "Choose your name"),
      ...[...new Set([...names, myName].filter(Boolean))].map(n => el("option", { value: n }, n)));
    meSelect.value = myName;
    $("tasks-all-wrap").hidden = view.mode !== "mine";
    $("tasks-all").checked = view.all;
    $("tasks-done").checked = view.done;

    const box = $("tasks-body");
    lists = new Map();

    if (view.mode === "everyone") {
      const list = tasksOf(pid);
      lists.set(pid, list);
      const comments = assignedComments(pid).filter(c => view.done || !c.thread.resolved);
      const people = [...new Set([...names, ...list.map(t => t.assignee), ...comments.map(c => c.thread.assignee)].filter(Boolean))];
      const groups = [...people, ""].map(person => {
        const tasks = list.filter(t => same(t.assignee, person) || (!person && !t.assignee)).filter(t => view.done || !t.done);
        const theirs = person ? comments.filter(c => same(c.thread.assignee, person)) : [];
        const open = list.filter(t => !t.done && (person ? same(t.assignee, person) : !t.assignee)).length + theirs.filter(c => !c.thread.resolved).length;
        if (!person && !tasks.length) return null;
        return el("section", { class: "task-group" },
          el("div", { class: "task-group-head" },
            el("h3", {}, person || "Unassigned", el("span", { class: "task-count" }, ` ${open} open`)),
            el("button", { type: "button", class: "comment-action", onclick: () => addTask(pid, person) }, `+ Task${person ? ` for ${person}` : ""}`)),
          tasks.length || theirs.length
            ? el("ul", { class: "task-list" }, tasks.map(t => taskRow(pid, t, names, { showAssignee: true })), theirs.map(c => commentRow(pid, c)))
            : el("p", { class: "media-muted" }, "Nothing to do."));
      }).filter(Boolean);
      box.replaceChildren(...(groups.length ? groups
        : [el("p", { class: "media-empty" }, "Add people to the team, then give them tasks.")]));
      return;
    }

    // My tasks
    if (!myName) {
      box.replaceChildren(el("p", { class: "media-empty" }, "Choose your name under “I am” to see what's assigned to you."));
      return;
    }
    const projects = view.all ? Projects.list().filter(p => !p.archived || p.id === pid) : Projects.list().filter(p => p.id === pid);
    const sections = projects.map(p => {
      const list = tasksOf(p.id);
      lists.set(p.id, list);
      const projectNames = (Projects.getDataFor(p.id, "team", []) || []).map(m => m.name).filter(Boolean);
      const tasks = list.filter(t => same(t.assignee, myName) && (view.done || !t.done))
        .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
      const comments = assignedComments(p.id).filter(c => same(c.thread.assignee, myName) && (view.done || !c.thread.resolved));
      if (!tasks.length && !comments.length) return null;
      return el("section", { class: "task-group" },
        el("div", { class: "task-group-head" }, el("h3", {}, view.all ? p.name : "Assigned to you")),
        el("ul", { class: "task-list" }, tasks.map(t => taskRow(p.id, t, projectNames, { showAssignee: false })), comments.map(c => commentRow(p.id, c))));
    }).filter(Boolean);
    box.replaceChildren(...(sections.length ? sections
      : [el("p", { class: "media-empty" }, `Nothing assigned to ${myName}${view.all ? " in any project" : " here"}.`)]));
  }


  /* =========================================================
     CREDITS
     ========================================================= */

  const FEATURE_ROLE = "Subject / Source";

  /* The credits as text: a line ending in ":" is a role, the lines under it are names */
  function creditsFromTeam() {
    const team = TeamPage.team();
    const order = TeamPage.roleOrder();
    const byRole = new Map();
    team.forEach(m => {
      const roles = m.roles.length ? m.roles : ["Team"];
      roles.filter(r => r !== FEATURE_ROLE).forEach(r => {
        if (!byRole.has(r)) byRole.set(r, []);
        byRole.get(r).push(m.name);
      });
    });
    const roles = [...byRole.keys()].sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
    const blocks = [TeamPage.projectName(), ""];
    roles.forEach(r => blocks.push(`${r}:`, ...byRole.get(r), ""));

    if ($("credits-featuring").checked) {
      const filmed = ["Filmed", "Follow Up Requested", "Follow Up Complete"];
      const people = (Projects.getDataFor(TeamPage.projectId(), "interviewees", []) || [])
        .filter(p => filmed.includes(p.stage) && p.name).map(p => p.name);
      const sources = team.filter(m => m.roles.includes(FEATURE_ROLE)).map(m => m.name);
      const featuring = [...new Set([...people, ...sources])];
      if (featuring.length) blocks.push("Featuring:", ...featuring, "");
    }
    return blocks.join("\n").trim() + "\n";
  }

  /* Text → [{ title }] and [{ role, names }] */
  function parseCredits(text) {
    const blocks = [];
    let current = null;
    text.split("\n").forEach(raw => {
      const line = raw.trim();
      if (!line) { current = null; return; }
      if (line.endsWith(":")) { current = { role: line.slice(0, -1).trim(), names: [] }; blocks.push(current); return; }
      if (current) current.names.push(line);
      else blocks.push({ title: line });
    });
    return blocks;
  }

  function creditsAsText(blocks, layout) {
    return blocks.map(b => {
      if (b.title) return b.title;
      if (layout === "inline") return `${b.role}: ${b.names.join(", ")}`;
      if (layout === "columns") return b.names.map((n, i) => `${i ? "" : b.role}\t${n}`).join("\n");
      return [b.role, ...b.names].join("\n");
    }).join("\n\n") + "\n";
  }

  /* Lays the credits out: returns lines to draw, each { text, size, align, x, gapAfter } and the total height */
  function layoutCredits(blocks, { w, h, layout }) {
    const unit = Math.min(w, h) / 1080;
    const titleSize = 64 * unit, roleSize = 30 * unit, nameSize = 46 * unit;
    const lines = [];
    blocks.forEach(b => {
      if (b.title) { lines.push({ text: b.title, size: titleSize, align: "center", x: w / 2, height: titleSize * 1.35, block: true }); return; }
      if (layout === "inline") {
        lines.push({ text: `${b.role}: ${b.names.join(", ")}`, size: nameSize * 0.85, align: "center", x: w / 2, height: nameSize * 1.25, block: true });
      } else if (layout === "columns") {
        b.names.forEach((n, i) => lines.push({ pair: [i ? "" : b.role, n], size: nameSize, roleSize, height: nameSize * 1.3, block: i === b.names.length - 1 }));
      } else {
        lines.push({ text: b.role.toUpperCase(), size: roleSize, align: "center", x: w / 2, height: roleSize * 1.6, role: true });
        b.names.forEach((n, i) => lines.push({ text: n, size: nameSize, align: "center", x: w / 2, height: nameSize * 1.25, block: i === b.names.length - 1 }));
      }
    });
    const gap = 48 * unit;
    let total = 0;
    lines.forEach(l => { total += l.height + (l.block ? gap : 0); });
    return { lines, total, gap, unit };
  }

  function drawLines(ctx, lines, { w, y, gap, font, ink, unit }) {
    ctx.fillStyle = ink;
    ctx.textBaseline = "top";
    lines.forEach(l => {
      if (l.pair) {
        ctx.font = `${l.roleSize}px ${font}`;
        ctx.globalAlpha = 0.75;
        ctx.textAlign = "right";
        ctx.fillText(l.pair[0].toUpperCase(), w / 2 - 24 * unit, y + (l.size - l.roleSize) * 0.6);
        ctx.globalAlpha = 1;
        ctx.font = `${l.size}px ${font}`;
        ctx.textAlign = "left";
        ctx.fillText(l.pair[1], w / 2 + 24 * unit, y);
      } else {
        ctx.font = `${l.size}px ${font}`;
        ctx.globalAlpha = l.role ? 0.75 : 1;
        ctx.textAlign = l.align;
        ctx.fillText(l.text, l.x, y, w * 0.9);
        ctx.globalAlpha = 1;
      }
      y += l.height + (l.block ? gap : 0);
    });
  }

  function creditOptions() {
    const [w, h] = $("credits-size").value.split("x").map(Number);
    return { w, h, layout: $("credits-layout").value, font: $("credits-font").value, ink: $("credits-ink").value, paper: $("credits-paper").value };
  }

  /* Cards: as many blocks as fit on each, centred */
  function creditCards(opts) {
    const { w, h } = opts;
    const blocks = parseCredits($("credits-text").value);
    const pages = [];
    let page = [];
    const fits = (list) => layoutCredits(list, opts).total <= h * 0.84;
    blocks.forEach(b => {
      if (page.length && !fits([...page, b])) { pages.push(page); page = []; }
      page.push(b);
    });
    if (page.length) pages.push(page);
    return pages.map(list => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (opts.paper) { ctx.fillStyle = opts.paper; ctx.fillRect(0, 0, w, h); }
      const { lines, total, gap, unit } = layoutCredits(list, opts);
      drawLines(ctx, lines, { w, y: (h - total + gap) / 2, gap, font: opts.font, ink: opts.ink, unit });
      return canvas;
    });
  }

  /* One tall image: starts and ends with an empty screen, for a roll from bottom to top */
  function creditRoll(opts) {
    const { w, h } = opts;
    const { lines, total, gap, unit } = layoutCredits(parseCredits($("credits-text").value), opts);
    const height = Math.min(32000, Math.ceil(h * 2 + total));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (opts.paper) { ctx.fillStyle = opts.paper; ctx.fillRect(0, 0, w, height); }
    drawLines(ctx, lines, { w, y: h, gap, font: opts.font, ink: opts.ink, unit });
    return canvas;
  }

  async function ensureFont(font) {
    try { await document.fonts.load(`48px ${font}`); } catch {}
  }

  async function preview() {
    const opts = creditOptions();
    await ensureFont(opts.font);
    const cards = creditCards(opts);
    const canvas = $("credits-preview");
    canvas.width = opts.w; canvas.height = opts.h;
    const ctx = canvas.getContext("2d");
    // A checkerboard behind transparent cards, so white text shows
    ctx.fillStyle = opts.ink === "#FFFFFF" ? "#3A3A44" : "#E6E6EA";
    ctx.fillRect(0, 0, opts.w, opts.h);
    if (cards[0]) ctx.drawImage(cards[0], 0, 0);
    $("credits-note").textContent = `${cards.length} card${cards.length === 1 ? "" : "s"} at ${opts.w} × ${opts.h}` +
      ` · the preview shows the first. In Resolve: drag the PNGs onto a video track above the picture.` +
      ` For a roll: put the tall PNG on a track, and keyframe Inspector › Transform › Position Y from bottom to top (or paste the text into Effects › Titles › Scroll).`;
  }

  const toBlob = (canvas) => new Promise(resolve => canvas.toBlob(resolve, "image/png"));

  function setUpCredits() {
    const dialog = $("credits-dialog");
    let built = false;
    $("team-credits").addEventListener("click", () => {
      if (!built || !$("credits-text").value.trim()) { $("credits-text").value = creditsFromTeam(); built = true; }
      dialog.showModal();
      preview();
    });
    document.addEventListener("team-changed", () => { built = false; });
    ["credits-layout", "credits-font", "credits-ink", "credits-paper", "credits-size"].forEach(id => $(id).addEventListener("change", preview));
    $("credits-featuring").addEventListener("change", () => { $("credits-text").value = creditsFromTeam(); preview(); });
    let timer = 0;
    $("credits-text").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(preview, 250); });
    $("credits-reset").addEventListener("click", () => {
      if (!confirm("Replace the text with credits built from the team again?")) return;
      $("credits-text").value = creditsFromTeam();
      preview();
    });
    const name = () => slug(TeamPage.projectName());
    $("credits-copy").addEventListener("click", async () => {
      const text = creditsAsText(parseCredits($("credits-text").value), $("credits-layout").value);
      try { await navigator.clipboard.writeText(text); $("credits-note").textContent = "Copied. Paste it into a Text+ or Scroll title in Resolve."; }
      catch { prompt("Copy the credits:", text); }
    });
    $("credits-txt").addEventListener("click", () => {
      const text = creditsAsText(parseCredits($("credits-text").value), $("credits-layout").value);
      download(new Blob([text], { type: "text/plain" }), `${name()}-credits.txt`);
    });
    $("credits-cards").addEventListener("click", async () => {
      const opts = creditOptions();
      await ensureFont(opts.font);
      const cards = creditCards(opts);
      if (cards.length === 1) { download(await toBlob(cards[0]), `${name()}-credits.png`); return; }
      const files = [];
      for (const [i, c] of cards.entries()) files.push({ name: `${name()}-credits-${pad(i + 1)}.png`, data: new Uint8Array(await (await toBlob(c)).arrayBuffer()) });
      download(Zip.create(files), `${name()}-credits.zip`);
    });
    $("credits-roll").addEventListener("click", async () => {
      const opts = creditOptions();
      await ensureFont(opts.font);
      download(await toBlob(creditRoll(opts)), `${name()}-credits-roll.png`);
    });
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    if (!window.TeamPage) return;
    document.querySelectorAll("[data-tasks-view]").forEach(b =>
      b.addEventListener("click", () => { view.mode = b.dataset.tasksView; saveView(); render(); }));
    $("tasks-me").addEventListener("change", (event) => { setMe(event.target.value); render(); });
    $("tasks-all").addEventListener("change", (event) => { view.all = event.target.checked; saveView(); render(); });
    $("tasks-done").addEventListener("change", (event) => { view.done = event.target.checked; saveView(); render(); });
    $("tasks-add").addEventListener("click", () => addTask(TeamPage.projectId(), view.mode === "mine" ? me() : ""));
    document.addEventListener("team-changed", render);
    document.addEventListener("comments-changed", render);
    document.addEventListener("projects-changed", render);
    setUpCredits();
    render();
  });
})();
