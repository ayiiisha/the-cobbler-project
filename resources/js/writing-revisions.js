/* =========================================================
   writing-revisions.js — the Revisions tab of the Writing page
   ---------------------------------------------------------
   • Versions: snapshots saved from the Draft tab ("Save
     version"), each with editor notes. Compare any two (or a
     version with the draft now) as tracked changes: words added
     and cut. Restore a version as a new draft.
   • Feedback: notes from editors and beta readers, by reader
     and round, tied to a scene, marked open / addressed / won't do.
   • Revision passes: a grid of scenes against passes (structure,
     dialogue, fact-check, proofread…) to tick off.
   • Legal review (articles): a pre-publication checklist.
   • Corrections log (articles): what was wrong, what's right,
     where it ran.
       project.data.corrections = [{ id, draftId, date, wrong, correct, where, notes }]

   Needs writing-core.js.
   ========================================================= */
(() => {

  const W = window.WritingPage;
  if (!W) return;
  const { el, newId } = W;

  const PASSES = {
    fiction: ["Structure", "Character", "Dialogue", "Description and setting", "Pacing", "Line edit", "Proofread"],
    article: ["Structure", "Fact-check", "Fairness and right of reply", "Line edit", "Headline, captions and links", "Proofread"],
  };
  const LEGAL = [
    ["named", "Every factual claim about a named person or company is sourced and checked"],
    ["reply", "Anyone accused of wrongdoing was given a fair chance to respond, and the response is included"],
    ["private", "Private details (health, address, family, sexuality) are published only where there's a clear public interest"],
    ["anon", "Anonymous sources are approved by an editor and the reason is recorded (Reporting › Sources)"],
    ["quotes", "Quotes are checked against recordings or notes (Check › Quote checker)"],
    ["docs", "Documents are authenticated, and leaked material is handled to protect sources"],
    ["images", "Photos, footage and music have rights or releases, and captions are accurate"],
    ["minors", "Children and vulnerable people are protected (consent, identification)"],
    ["headline", "The headline, standfirst and social posts say no more than the story can support"],
    ["opinion", "Opinion and analysis are clearly labelled, and conflicts of interest disclosed"],
  ];
  const FEEDBACK_STATUSES = ["Open", "Addressed", "Won't do"];

  let compare = { a: "", b: "current" };
  const feedbackView = { reader: "", status: "Open" };

  function render(panel) {
    const d = W.current();
    if (!d) { panel.replaceChildren(el("p", { class: "media-empty" }, "Start a draft first.")); return; }
    if (!Array.isArray(d.passList) || !d.passList.length) d.passList = PASSES[d.kind].map(name => ({ id: newId("ps"), name }));
    panel.replaceChildren(...[
      versionsSection(d, panel),
      feedbackSection(d, panel),
      passesSection(d, panel),
      d.kind === "article" && legalSection(d),
      d.kind === "article" && correctionsSection(d, panel),
    ].filter(Boolean));
  }


  /* =========================================================
     VERSIONS AND TRACKED CHANGES
     ========================================================= */

  // Longest common subsequence of two lists → [["same"|"del"|"ins", item], ...]
  function lcsDiff(a, b, same = (x, y) => x === y) {
    const n = a.length, m = b.length;
    if (n * m > 4_000_000) return [...a.map(x => ["del", x]), ...b.map(x => ["ins", x])];
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (same(a[i], b[j])) { out.push(["same", b[j]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(["del", a[i++]]);
      else out.push(["ins", b[j++]]);
    }
    while (i < n) out.push(["del", a[i++]]);
    while (j < m) out.push(["ins", b[j++]]);
    return out;
  }

  /* Paragraphs first; a changed paragraph is then compared word by word */
  function trackedChanges(oldText, newText) {
    const paras = (t) => t.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const ops = lcsDiff(paras(oldText), paras(newText));
    const out = [];
    let added = 0, cut = 0;
    for (let i = 0; i < ops.length; i++) {
      const [kind, text] = ops[i];
      if (kind === "del" && ops[i + 1]?.[0] === "ins") {
        // A rewritten paragraph: show the word changes inside it
        const a = text.split(/(\s+)/), b = ops[i + 1][1].split(/(\s+)/);
        const words = lcsDiff(a, b);
        words.forEach(([k, w]) => { if (k === "ins" && w.trim()) added++; if (k === "del" && w.trim()) cut++; });
        out.push(el("p", { class: "wr-diff-p" }, words.map(([k, w]) => k === "same" ? w : el(k, {}, w))));
        i++;
        continue;
      }
      const n = W.words(text);
      if (kind === "ins") added += n;
      if (kind === "del") cut += n;
      out.push(el("p", { class: `wr-diff-p${kind === "same" ? "" : ` is-${kind}`}` }, kind === "same" ? text : el(kind, {}, text)));
    }
    return { nodes: out, added, cut };
  }

  function versionsSection(d, panel) {
    const versions = [...d.versions].sort((a, b) => b.at - a.at);
    const when = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
    const textOf = (id) => id === "current" ? W.draftText(d) : d.versions.find(v => v.id === id)?.text || "";
    const options = [["current", "The draft now"], ...versions.map(v => [v.id, `${v.label} (${when(v.at)})`])];
    if (!options.some(o => o[0] === compare.a)) compare.a = versions[0]?.id || "";
    if (!options.some(o => o[0] === compare.b)) compare.b = "current";
    const pick = (key, label) => {
      const s = el("select", { class: "team-select", "aria-label": label }, options.map(([v, t]) => el("option", { value: v }, t)));
      s.value = compare[key];
      s.addEventListener("change", () => { compare[key] = s.value; render(panel); });
      return s;
    };

    let diffBox = null;
    if (compare.a && compare.a !== compare.b) {
      const { nodes, added, cut } = trackedChanges(textOf(compare.a), textOf(compare.b));
      diffBox = el("div", { class: "wr-diff-wrap" },
        el("p", { class: "media-muted" }, `${added} word${added === 1 ? "" : "s"} added (underlined), ${cut} cut (struck through).`),
        el("div", { class: "wr-diff" }, nodes));
    }

    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Versions and tracked changes"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          const label = prompt("Name this version:", `Version ${d.versions.length + 1}`);
          if (label == null) return;
          d.versions.push({ id: newId("v"), at: Date.now(), by: Projects.me() || "", label: label.trim() || `Version ${d.versions.length + 1}`, text: W.draftText(d), notes: "" });
          W.save(); render(panel);
        } }, "Save version now")),
      versions.length ? el("ol", { class: "wr-versions" }, versions.map(v => {
        const notes = el("textarea", { rows: "2", placeholder: "Editor's notes for this round", "aria-label": `Notes on ${v.label}` });
        notes.value = v.notes || "";
        notes.addEventListener("input", () => { v.notes = notes.value; W.save({ soon: true }); });
        return el("li", { class: "wr-version" },
          el("div", { class: "wr-claim-head" },
            el("strong", {}, v.label), el("span", { class: "media-muted" }, `${when(v.at)}${v.by ? ` · ${v.by}` : ""} · ${W.words(v.text).toLocaleString()} word${W.words(v.text) === 1 ? "" : "s"}`),
            el("span", { class: "comment-actions" },
              el("button", { type: "button", class: "comment-action", onclick: () => { compare = { a: v.id, b: "current" }; render(panel); } }, "Compare with now"),
              el("button", { type: "button", class: "comment-action", onclick: () => restore(d, v) }, "Restore as a new draft"),
              el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm(`Delete “${v.label}”?`)) { d.versions.splice(d.versions.indexOf(v), 1); W.save(); render(panel); } } }, "Delete"))),
          notes);
      })) : el("p", { class: "media-empty" }, "Save a version before big edits or before sending to an editor; compare later to see exactly what changed."),
      versions.length > 0 && el("div", { class: "sketch-nav" }, el("label", { class: "tool-group" }, "Compare", pick("a", "From")), el("label", { class: "tool-group" }, "with", pick("b", "To"))),
      diffBox);
  }

  // A version's text (with # part / ## scene headings) back into a draft
  function restore(d, v) {
    const parts = [];
    let part = null, scene = null;
    const newScene = (title) => { scene = { id: newId("sc"), title, text: "", synopsis: "", pov: "", setting: "", when: "", status: "Revising", threads: [], passes: {}, notes: "" }; part.scenes.push(scene); };
    v.text.split("\n").forEach(line => {
      const h1 = line.match(/^# (.*)$/), h2 = line.match(/^## (.*)$/);
      if (h1) { part = { id: newId("pt"), title: h1[1], scenes: [] }; parts.push(part); scene = null; return; }
      if (!part) { part = { id: newId("pt"), title: d.parts[0]?.title || "", scenes: [] }; parts.push(part); }
      if (h2) { newScene(h2[1]); return; }
      if (!scene) newScene("");
      scene.text += (scene.text ? "\n" : "") + line;
    });
    parts.forEach(p => p.scenes.forEach(s => { s.text = s.text.replace(/\n{3,}/g, "\n\n").trim(); }));
    const copy = W.normalize({ ...JSON.parse(JSON.stringify(d)), id: newId("dr"), title: `${d.title} (${v.label})`, parts, versions: [], created: Date.now(), updated: Date.now() });
    W.drafts().push(copy);
    W.save();
    W.select(copy.id);
    W.setStatus(`Restored “${v.label}” as a new draft. The original is unchanged.`);
  }


  /* =========================================================
     FEEDBACK
     ========================================================= */

  function feedbackSection(d, panel) {
    const readers = [...new Set(d.feedback.map(f => f.reader).filter(Boolean))];
    const shown = d.feedback.filter(f => (!feedbackView.reader || f.reader === feedbackView.reader) && (!feedbackView.status || f.status === feedbackView.status));
    const scenes = W.scenes(d);
    const filter = (key, options, label) => {
      const s = el("select", { class: "team-select", "aria-label": label }, options.map(([v, t]) => el("option", { value: v }, t)));
      s.value = feedbackView[key];
      s.addEventListener("change", () => { feedbackView[key] = s.value; render(panel); });
      return s;
    };
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, d.kind === "fiction" ? "Feedback from beta readers and editors" : "Editor's feedback"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          d.feedback.push({ id: newId("fb"), reader: feedbackView.reader || "", round: String(d.versions.length || 1), sceneId: "", note: "", status: "Open", at: Date.now() });
          feedbackView.status = "Open";
          W.save(); render(panel);
        } }, "+ Note")),
      el("div", { class: "sketch-nav" },
        filter("reader", [["", "Every reader"], ...readers.map(r => [r, r])], "Reader"),
        filter("status", [["", "Any status"], ...FEEDBACK_STATUSES.map(s => [s, `${s} (${d.feedback.filter(f => f.status === s).length})`])], "Status")),
      shown.length ? el("ol", { class: "wr-claims" }, shown.map(f => {
        const input = (key, label, attrs = {}) => {
          const i = el("input", { value: f[key] || "", placeholder: label, "aria-label": label, ...attrs });
          i.addEventListener("input", () => { f[key] = i.value; W.save({ soon: true }); });
          return i;
        };
        const scene = el("select", { class: "team-select", "aria-label": "Scene" }, el("option", { value: "" }, "Whole draft"), scenes.map(x => el("option", { value: x.scene.id }, x.scene.title || "Untitled")));
        scene.value = f.sceneId || "";
        scene.addEventListener("change", () => { f.sceneId = scene.value; W.save(); });
        const status = el("select", { class: "team-select", "aria-label": "Status" }, FEEDBACK_STATUSES.map(s => el("option", { value: s }, s)));
        status.value = f.status;
        status.addEventListener("change", () => { f.status = status.value; W.save(); render(panel); });
        const note = el("textarea", { rows: "2", placeholder: "What they said", "aria-label": "Feedback" });
        note.value = f.note;
        note.addEventListener("input", () => { f.note = note.value; W.save({ soon: true }); });
        return el("li", { class: `wr-claim is-${f.status === "Open" ? "unchecked" : "verified"}` },
          el("div", { class: "wr-feedback-row" }, input("reader", "Reader", { class: "wr-short" }), input("round", "Round", { class: "wr-tiny" }), scene, status,
            el("button", { type: "button", class: "comment-action", onclick: () => { d.feedback.splice(d.feedback.indexOf(f), 1); W.save(); render(panel); } }, "Delete")),
          note);
      })) : el("p", { class: "media-empty" }, d.feedback.length ? "Nothing matches." : "Collect notes from readers and editors here, then mark each one addressed as you revise."));
  }


  /* =========================================================
     REVISION PASSES
     ========================================================= */

  function passesSection(d, panel) {
    const scenes = W.scenes(d);
    const done = (p) => scenes.filter(x => x.scene.passes[p.id]).length;
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Revision passes"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          const name = prompt("Name of the pass (e.g. “Cut 10%”, “Sensitivity read”):");
          if (!name?.trim()) return;
          d.passList.push({ id: newId("ps"), name: name.trim() });
          W.save(); render(panel);
        } }, "+ Pass")),
      !scenes.length ? el("p", { class: "media-empty" }, "No scenes yet.")
        : el("div", { class: "tracker-wrap" }, el("table", { class: "tracker-table wr-threads wr-passes" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, d.kind === "fiction" ? "Scene" : "Section"),
            d.passList.map(p => el("th", { scope: "col" }, p.name, el("span", { class: "wr-count" }, ` ${done(p)}/${scenes.length}`),
              el("button", { type: "button", class: "goal-item-remove", "aria-label": `Remove the pass ${p.name}`, onclick: () => {
                if (!confirm(`Remove the pass “${p.name}”?`)) return;
                d.passList.splice(d.passList.indexOf(p), 1); W.save(); render(panel);
              } }, "×"))))),
          el("tbody", {}, scenes.map(x => el("tr", {},
            el("th", { scope: "row" }, x.scene.title || "Untitled"),
            d.passList.map(p => el("td", {}, el("input", { type: "checkbox", checked: !!x.scene.passes[p.id], "aria-label": `${p.name}: ${x.scene.title}`,
              onchange: (e) => { if (e.target.checked) x.scene.passes[p.id] = true; else delete x.scene.passes[p.id]; W.save(); } })))))))));
  }


  /* =========================================================
     LEGAL REVIEW AND CORRECTIONS (articles)
     ========================================================= */

  function legalSection(d) {
    const count = () => LEGAL.filter(([id]) => d.legal[id]).length;
    const total = el("span", { class: "pk-count" }, `${count()} / ${LEGAL.length}`);
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Before publishing: legal and ethics review"), total),
      el("ul", { class: "pk-deliverables" }, LEGAL.map(([id, text]) => {
        const box = el("input", { type: "checkbox", checked: !!d.legal[id] });
        box.addEventListener("change", () => { if (box.checked) d.legal[id] = true; else delete d.legal[id]; W.save(); total.textContent = `${count()} / ${LEGAL.length}`; });
        return el("li", {}, el("label", { class: "pk-deliverable" }, box, el("span", {}, text)));
      })),
      el("p", { class: "media-muted" }, "A checklist to catch common problems, not legal advice. For anything that could be defamatory or breaks a confidence, ask an editor or a media lawyer."));
  }

  function correctionsSection(d, panel) {
    const all = W.list("corrections");
    const save = () => W.saveList("corrections", all);
    const mine = all.filter(c => c.draftId === d.id);
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Corrections"),
        el("button", { type: "button", class: "small-btn", onclick: () => {
          all.push({ id: newId("co"), draftId: d.id, date: W.todayISO(), wrong: "", correct: "", where: "", notes: "" });
          save(); render(panel);
        } }, "+ Correction")),
      mine.length ? el("ol", { class: "wr-claims" }, mine.map(c => {
        const f = (key, label, type = "text") => {
          const i = el("input", { type, value: c[key] || "", placeholder: label, "aria-label": label });
          i.addEventListener("change", () => { c[key] = i.value; save(); });
          return el("label", { class: "wr-field" }, label, i);
        };
        const notice = `Correction${c.date ? ` (${W.fmtDate(c.date)})` : ""}: An earlier version of this story ${c.wrong ? `said ${c.wrong}` : "…"}. ${c.correct ? `In fact, ${c.correct}.` : ""}`;
        return el("li", { class: "wr-claim" },
          el("div", { class: "zine-form-row" }, f("date", "Date", "date"), f("where", "Where it ran (link, edition)")),
          f("wrong", "What it said (wrong)"), f("correct", "What's right"),
          el("p", { class: "media-muted" }, `Suggested note: ${notice}`),
          el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "comment-action", onclick: async () => { try { await navigator.clipboard.writeText(notice); W.setStatus("Correction note copied."); } catch { prompt("Copy:", notice); } } }, "Copy the note"),
            el("button", { type: "button", class: "comment-action", onclick: () => { all.splice(all.indexOf(c), 1); save(); render(panel); } }, "Delete")));
      })) : el("p", { class: "media-empty" }, "None, hopefully. If one is needed, log it here with what was wrong, what's right and where it ran."));
  }

  W.register("revisions", { render });
  W.trackedChanges = trackedChanges;
})();
