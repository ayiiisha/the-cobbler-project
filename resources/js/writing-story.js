/* =========================================================
   writing-story.js — the Story tab of the Writing page
   ---------------------------------------------------------
   • Story bible: characters, places, things, groups and lore
     (or, for nonfiction, the people and places in the story),
     shared by every draft in the project. Each entry lists the
     scenes that mention it (by name or alias).
       project.data.storyBible = [{ id, type, name, aliases: [], summary, details }]
   • Plot threads (fiction): a grid of threads against scenes.
     Click a square to say a scene carries that thread. Threads
     missing for a long stretch, or that stop well before the
     end, are flagged.
   • Story timeline (fiction): scenes in story order (from each
     scene's "Story time") beside reading order, so flashbacks
     and jumps are easy to see.

   Needs writing-core.js.
   ========================================================= */
(() => {

  const W = window.WritingPage;
  if (!W) return;
  const { el, newId } = W;

  const TYPES = ["Character", "Place", "Thing", "Group", "Lore"];
  const typeName = (t) => t === "Character" && W.current()?.kind === "article" ? "Person" : t;
  const view = { type: "", search: "" };

  function render(panel) {
    const d = W.current();
    W.fill(panel,
      bibleSection(d, panel),
      d?.kind === "fiction" && threadsSection(d, panel),
      d?.kind === "fiction" && timelineSection(d));
  }


  /* =========================================================
     STORY BIBLE
     ========================================================= */

  const mentions = (d, entry) => {
    if (!d) return [];
    const names = [entry.name, ...(entry.aliases || [])].map(n => (n || "").trim()).filter(Boolean);
    if (!names.length) return [];
    const re = new RegExp(`\\b(?:${names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "i");
    return W.scenes(d).filter(x => re.test(x.scene.text));
  };

  function bibleSection(d, panel) {
    const bible = W.list("storyBible");
    const save = () => W.saveList("storyBible", bible);
    const words = view.search.trim().toLowerCase();
    const shown = bible.filter(b => !view.type || b.type === view.type)
      .filter(b => !words || [b.name, b.summary, b.details, ...(b.aliases || [])].join(" ").toLowerCase().includes(words));

    const search = el("input", { type: "search", class: "tracker-search", placeholder: "Search the bible", value: view.search, "aria-label": "Search the story bible" });
    search.addEventListener("input", () => { view.search = search.value; render(panel); search.focus(); search.setSelectionRange(search.value.length, search.value.length); });

    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" },
        el("h2", {}, d?.kind === "article" ? "People, places and things" : "Story bible"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          bible.push({ id: newId("sb"), type: view.type || "Character", name: "", aliases: [], summary: "", details: "" });
          save(); render(panel);
          document.querySelector(".wr-bible-card:last-child input")?.focus();
        } }, "+ Entry")),
      el("div", { class: "sketch-nav" },
        el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "Show" },
          ["", ...TYPES].map(t => el("button", { type: "button", "aria-pressed": String(view.type === t), onclick: () => { view.type = t; render(panel); } },
            `${typeName(t) || "All"} (${bible.filter(b => !t || b.type === t).length})`))),
        search),
      shown.length ? el("div", { class: "wr-bible" }, shown.map(b => {
        const input = (key, label, attrs = {}) => {
          const i = el("input", { value: key === "aliases" ? (b.aliases || []).join(", ") : b[key] || "", "aria-label": label, placeholder: label, ...attrs });
          i.addEventListener("input", () => { b[key] = key === "aliases" ? i.value.split(",").map(x => x.trim()).filter(Boolean) : i.value; save(); });
          return i;
        };
        const area = (key, label, rows) => {
          const t = el("textarea", { rows: String(rows), placeholder: label, "aria-label": label });
          t.value = b[key] || "";
          t.addEventListener("input", () => { b[key] = t.value; save(); });
          return t;
        };
        const type = el("select", { class: "team-select", "aria-label": "Type" }, TYPES.map(t => el("option", { value: t }, typeName(t))));
        type.value = b.type;
        type.addEventListener("change", () => { b.type = type.value; save(); render(panel); });
        const where = mentions(d, b);
        return el("article", { class: "research-card wr-bible-card" },
          el("div", { class: "research-card-head" }, input("name", "Name", { class: "wr-bible-name" }), type),
          input("aliases", "Also called (commas between)"),
          area("summary", "One-line summary", 2),
          area("details", d?.kind === "article" ? "Details: role, how you know them, spelling, facts to keep straight" : "Details: look, voice, wants, fears, history, rules", 4),
          el("p", { class: "media-muted" }, where.length ? `In ${where.length} scene${where.length === 1 ? "" : "s"}: ${where.slice(0, 6).map(x => x.scene.title || "Untitled").join(", ")}${where.length > 6 ? "…" : ""}` : "Not mentioned in this draft yet."),
          el("div", { class: "comment-actions" }, el("button", { type: "button", class: "comment-action", onclick: () => {
            if (!confirm(`Delete “${b.name || "this entry"}”?`)) return;
            bible.splice(bible.indexOf(b), 1); save(); render(panel);
          } }, "Delete")));
      })) : el("p", { class: "media-empty" }, bible.length ? "Nothing matches." : "Keep track of everyone and everything in the story: names, spellings, looks, histories, rules of the world."));
  }


  /* =========================================================
     PLOT THREADS
     ========================================================= */

  function threadsSection(d, panel) {
    const list = W.scenes(d);
    const flags = d.threads.map(t => {
      const idx = list.map((x, i) => x.scene.threads.includes(t.id) ? i : -1).filter(i => i >= 0);
      if (!idx.length) return { t, note: "Not in any scene yet" };
      const gaps = idx.slice(1).map((v, i) => v - idx[i]);
      const longest = Math.max(0, ...gaps);
      const lastFromEnd = list.length - 1 - idx[idx.length - 1];
      if (list.length >= 6 && lastFromEnd > Math.max(3, list.length * 0.25)) return { t, note: `Last seen ${lastFromEnd} scenes before the end: resolved?` };
      if (longest > Math.max(5, list.length * 0.3)) return { t, note: `Missing for ${longest - 1} scenes in a row` };
      return { t, note: "" };
    });
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" },
        el("h2", {}, "Plot threads"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          const name = prompt("Thread name (e.g. “The missing letter”, “Maya and Jun”):");
          if (!name?.trim()) return;
          d.threads.push({ id: newId("th"), name: name.trim() });
          W.save(); render(panel);
        } }, "+ Thread")),
      !d.threads.length ? el("p", { class: "media-empty" }, "Add the story's threads (subplots, relationships, mysteries), then mark which scenes carry each one.")
        : el("div", { class: "tracker-wrap" }, el("table", { class: "tracker-table wr-threads" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Thread"),
            list.map((x, i) => el("th", { scope: "col", title: `${x.part.title} › ${x.scene.title}` }, String(i + 1))))),
          el("tbody", {}, flags.map(({ t, note }) => el("tr", {},
            el("th", { scope: "row" },
              el("span", { class: "wr-thread-name" }, t.name),
              el("span", { class: "comment-actions" },
                el("button", { type: "button", class: "comment-action", onclick: () => { const n = prompt("Rename thread:", t.name); if (n?.trim()) { t.name = n.trim(); W.save(); render(panel); } } }, "Rename"),
                el("button", { type: "button", class: "comment-action", onclick: () => {
                  if (!confirm(`Delete the thread “${t.name}”?`)) return;
                  d.threads.splice(d.threads.indexOf(t), 1);
                  list.forEach(x => { x.scene.threads = x.scene.threads.filter(id => id !== t.id); });
                  W.save(); render(panel);
                } }, "Delete")),
              note && el("span", { class: "wr-thread-flag" }, note)),
            list.map(x => {
              const on = x.scene.threads.includes(t.id);
              return el("td", {}, el("button", { type: "button", class: `wr-cell${on ? " is-on" : ""}`, "aria-pressed": String(on),
                "aria-label": `${t.name} in ${x.scene.title || "scene"}`, onclick: () => {
                  x.scene.threads = on ? x.scene.threads.filter(id => id !== t.id) : [...x.scene.threads, t.id];
                  W.save(); render(panel);
                } }, on ? "●" : ""));
            })))))),
      d.threads.length > 0 && el("p", { class: "media-muted" }, "Numbers are scenes in reading order (hover for names)."));
  }


  /* =========================================================
     STORY TIMELINE
     ========================================================= */

  // Sorts "Day 3", "1987-05-04", "Chapter 2 morning"… sensibly: dates first, then numbers, then text
  function sortKey(when) {
    const t = String(when || "").trim();
    const date = t.match(/\b(\d{3,4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (date) return [0, Number(date[1]) * 10000 + Number(date[2]) * 100 + Number(date[3] || 0), t];
    const n = t.match(/-?\d+(\.\d+)?/);
    if (n) return [1, Number(n[0]), t];
    return [2, 0, t];
  }

  function timelineSection(d) {
    const list = W.scenes(d).map((x, i) => ({ ...x, order: i + 1 }));
    const timed = list.filter(x => x.scene.when.trim());
    const story = [...timed].sort((a, b) => {
      const A = sortKey(a.scene.when), B = sortKey(b.scene.when);
      return A[0] - B[0] || A[1] - B[1] || a.order - b.order;
    });
    let maxSeen = 0;
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Story timeline")),
      !timed.length ? el("p", { class: "media-empty" }, "Give scenes a “Story time” in the Draft tab's inspector (a date, “Day 3”, “1987”) to see them in the order they happen.")
        : el("ol", { class: "wr-timeline" }, story.map(x => {
          const jump = x.order < maxSeen;
          maxSeen = Math.max(maxSeen, x.order);
          return el("li", { class: jump ? "is-jump" : null },
            el("span", { class: "wr-when" }, x.scene.when),
            el("span", {}, el("strong", {}, x.scene.title || "Untitled"), ` · ${x.part.title || "Part"} · read as scene ${x.order}`,
              x.scene.pov && el("span", { class: "media-muted" }, ` · POV ${x.scene.pov}`)),
            jump && el("span", { class: "wr-thread-flag" }, "told earlier than this point"));
        })),
      timed.length > 0 && timed.length < list.length && el("p", { class: "media-muted" }, `${list.length - timed.length} scene${list.length - timed.length === 1 ? " has" : "s have"} no story time.`));
  }

  W.register("story", { render });
})();
