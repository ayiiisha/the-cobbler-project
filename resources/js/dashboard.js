/* =========================================================
   dashboard.js — the Home page dashboard
   ---------------------------------------------------------
   At a glance, across every project that isn't archived:
     • Due soon: anything overdue or due in the next 7 days
       (every date the Calendar knows about)
     • For you: tasks and comments assigned to you
   And for the active project:
     • In progress: drafts, scripts, songs, packages and edits
     • Recent activity: who changed what

   Needs projects-core.js and calendar.js (CobblerCalendar).
   ========================================================= */
(() => {

  if (!window.Projects) return;
  const $ = (id) => document.getElementById(id);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmt = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }); };
  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 3600 ? `${Math.max(1, Math.round(s / 60))} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  };
  const list = (id, key) => { const v = Projects.getDataFor(id, key, []); return Array.isArray(v) ? v : []; };
  const words = (t) => (String(t || "").match(/\S+/g) || []).length;

  // Past dates worth showing as overdue: open tasks, records requests, release steps, recent draft deadlines
  function canBeLate(e, todayISO) {
    if (e.source === "tasks" || e.uid.startsWith("records-") || /^release-[^-]+-.+/.test(e.uid)) return true;
    if (e.uid.startsWith("draft-deadline-")) {
      const two = new Date(); two.setDate(two.getDate() - 14);
      return e.date >= iso(two);
    }
    return false;
  }

  function card(title, link, body) {
    return el("section", { class: "dash-card" },
      el("div", { class: "dash-head" }, el("h2", {}, title), link && el("a", { href: link[0] }, link[1])), body);
  }

  function render() {
    const box = $("dashboard");
    if (!box) return;
    const projects = Projects.list().filter(p => !p.archived);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayISO = iso(today);
    const week = new Date(today); week.setDate(week.getDate() + 7);
    const weekISO = iso(week);
    const multi = projects.length > 1;

    // Due soon
    const dates = window.CobblerCalendar
      ? projects.flatMap(p => CobblerCalendar.datesFor(p.id, p.name))
          .filter(e => e.date <= weekISO && (e.date >= todayISO || canBeLate(e, todayISO)))
          .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")))
      : [];
    const due = dates.slice(0, 12).map(e => {
      const page = CobblerCalendar.SOURCES[e.source]?.page;
      return el("li", { class: `dash-item${e.date < todayISO ? " is-late" : ""}` },
        el("span", { class: "dash-when" }, e.date < todayISO ? `Overdue · ${fmt(e.date)}` : e.date === todayISO ? "Today" : fmt(e.date)),
        page ? el("a", { href: page }, e.title) : el("span", {}, e.title),
        multi && el("span", { class: "media-muted" }, ` · ${e.projectName}`));
    });

    // For you
    const me = Projects.me();
    const mine = [];
    if (me) projects.forEach(p => {
      list(p.id, "tasks").filter(t => !t.done && (t.assignee || "").toLowerCase() === me.toLowerCase())
        .forEach(t => mine.push({ text: t.text, href: "team.html#tasks", note: t.due ? `due ${fmt(t.due)}` : "task", project: p.name }));
      const comments = Projects.getDataFor(p.id, "comments", {}) || {};
      Object.entries(comments).forEach(([page, threads]) => (Array.isArray(threads) ? threads : [])
        .filter(t => !t.resolved && (t.assignee || "").toLowerCase() === me.toLowerCase())
        .forEach(t => mine.push({ text: t.text, href: `${page}.html`, note: `comment from ${t.author || "someone"}`, project: p.name })));
    });

    // In progress (active project)
    const id = Projects.activeId();
    const progress = [
      ...list(id, "drafts").map(d => {
        const n = (d.parts || []).flatMap(p => p.scenes || []).reduce((s, x) => s + words(x.text), 0);
        return { kind: "Draft", name: d.title || "Untitled", note: `${n.toLocaleString()} words${d.target ? ` of ${Number(d.target).toLocaleString()}` : ""}`, href: "writing.html", pct: d.target ? n / d.target : null };
      }),
      ...list(id, "screenplays").map(s => ({ kind: "Script", name: s.title || "Untitled", note: `${(s.elements || []).filter(e => e.type === "scene" && String(e.text || "").trim()).length} scenes`, href: "screenplay.html" })),
      ...list(id, "songs").filter(s => s.status !== "Released").map(s => ({ kind: "Song", name: s.title || "Untitled", note: s.status || "Idea", href: "music.html" })),
      ...list(id, "packaging").map(p => ({ kind: "Package", name: p.name || (p.titles || []).find(t => t.chosen)?.text || "Untitled", note: p.platform, href: "packaging.html" })),
      ...list(id, "edits").map(e => ({ kind: "Paper edit", name: e.name || "Untitled", note: `${(e.blocks || []).length} lines`, href: "media-and-transcripts.html#edit" })),
    ].slice(0, 10);

    const activity = Projects.activity(id).slice(0, 8);

    box.replaceChildren(
      card("Due soon", ["calendar.html", "Calendar"], due.length ? el("ul", { class: "dash-list" }, due) : el("p", { class: "media-muted" }, "Nothing due in the next week.")),
      card("For you", ["team.html#tasks", "All tasks"], !me
        ? el("p", { class: "media-muted" }, "Sign in with your name (the person button, bottom right) to see what's assigned to you. ",
            el("button", { type: "button", class: "comment-action", onclick: () => window.CobblerAccount?.open() }, "Sign in"))
        : mine.length ? el("ul", { class: "dash-list" }, mine.slice(0, 10).map(m => el("li", { class: "dash-item" },
            el("a", { href: m.href }, m.text.length > 80 ? m.text.slice(0, 79) + "…" : m.text),
            el("span", { class: "media-muted" }, ` · ${m.note}${multi ? ` · ${m.project}` : ""}`))))
        : el("p", { class: "media-muted" }, `Nothing assigned to ${me}.`)),
      card(`In progress: ${Projects.activeName()}`, null, progress.length ? el("ul", { class: "dash-list" }, progress.map(x => el("li", { class: "dash-item" },
          el("span", { class: "dash-when" }, x.kind), el("a", { href: x.href }, x.name), el("span", { class: "media-muted" }, ` · ${x.note}`),
          x.pct != null && el("progress", { max: "1", value: String(Math.min(1, x.pct)), "aria-label": `${x.name} progress` }))))
        : el("p", { class: "media-muted" }, "Nothing started yet in this project.")),
      card("Recent activity", ["projects.html#activity", "All activity"], activity.length ? el("ul", { class: "dash-list" }, activity.map(a => el("li", { class: "dash-item" },
          el("span", { class: "dash-when" }, ago(a.at)), el("strong", {}, a.by || "Someone"),
          ` ${a.kind === "added" ? "added" : a.kind === "deleted" ? "deleted" : "changed"} ${a.label}`)))
        : el("p", { class: "media-muted" }, "Changes appear here as you and your collaborators work.")));
  }

  document.addEventListener("DOMContentLoaded", render);
  document.addEventListener("projects-changed", render);
})();
