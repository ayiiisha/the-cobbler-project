/* =========================================================
   writing-draft.js — the Draft tab of the Writing page
   ---------------------------------------------------------
   • Binder: parts (chapters) and their scenes (sections). Add,
     rename, reorder, delete.
   • Write view: the whole draft as one scrolling page, a box
     per scene; the inspector beside it shows the scene you're in
     (synopsis, status, point of view, setting, story time, plot
     threads, notes, story-bible names it mentions).
   • Corkboard: a card per scene with its synopsis.
   • Mark a sentence as a claim to fact-check, save a
     version, draft details.
   • Export: standard manuscript format (.docx), a document
     (.docx or PDF), Markdown or plain text.

   Needs writing-core.js (and doc-export.js, zip.js for export).
   ========================================================= */
(() => {

  const W = window.WritingPage;
  if (!W) return;
  const { el, newId, words } = W;

  let view = "write";          // "write" or "cork"
  let focusSceneId = null;     // the scene being edited (for the inspector)
  let lastSelection = null;    // { sceneId, text } for "Mark as claim"


  /* =========================================================
     THE TAB
     ========================================================= */

  function render(panel) {
    const d = W.current();
    if (!d) {
      panel.replaceChildren(el("div", { class: "wr-empty" },
        el("p", { class: "media-empty" }, "No drafts yet. Start one with “+ New draft”: an article or a piece of fiction, blank or from a structure (inverted pyramid, feature, Save the Cat, Hero's Journey…)."),
        el("button", { type: "button", class: "small-btn", onclick: () => W.$("wr-new").click() }, "+ New draft")));
      return;
    }
    if (!W.scenes(d).some(x => x.scene.id === focusSceneId)) focusSceneId = W.scenes(d)[0]?.scene.id || null;

    const toolbar = el("div", { class: "sketch-nav wr-toolbar" },
      el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "View" },
        el("button", { type: "button", "aria-pressed": String(view === "write"), onclick: () => { view = "write"; render(panel); } }, "Write"),
        el("button", { type: "button", "aria-pressed": String(view === "cork"), onclick: () => { view = "cork"; render(panel); } }, "Corkboard")),
      d.kind === "article" && el("button", { type: "button", class: "small-btn", onclick: markClaim, title: "Select a sentence first" }, "Mark as claim"),
      el("button", { type: "button", class: "small-btn", onclick: () => saveVersion(d) }, "Save version"),
      el("button", { type: "button", class: "small-btn", onclick: () => packageDraft(d), title: "Start titles, SEO and alt text for this on the Packaging page" }, "Package this"),
      exportMenu(d));

    panel.replaceChildren(
      detailsBox(d),
      toolbar,
      view === "cork" ? corkboard(d, panel) : el("div", { class: "wr-layout" }, binder(d, panel), writer(d), inspector(d)));
  }

  /* ---------- Draft details (title, byline, contact, dates…) ---------- */
  function detailsBox(d) {
    const field = (key, label, attrs = {}, { textarea = false, onChange = null } = {}) => {
      const input = textarea ? el("textarea", { rows: "3", ...attrs }) : el("input", attrs);
      input.value = d[key] ?? "";
      input.addEventListener("input", () => { d[key] = input.type === "number" ? Number(input.value) || 0 : input.value; W.save({ soon: true }); onChange?.(); });
      return el("label", { class: "wr-field" }, label, input);
    };
    const guide = el("select", { class: "team-select" }, ["AP", "Chicago"].map(g => el("option", { value: g }, g === "AP" ? "AP style" : "Chicago style")));
    guide.value = d.styleGuide;
    guide.addEventListener("change", () => { d.styleGuide = guide.value; W.save(); });
    const open = (() => { try { return localStorage.getItem("wrDetailsOpen") === "1"; } catch { return false; } })();
    const box = el("details", { class: "wr-details", open },
      el("summary", {}, "Draft details"),
      el("div", { class: "wr-details-grid" },
        field("title", "Title", { maxlength: "160" }, { onChange: () => W.renderTop() }),
        field("byline", "Author / byline", { maxlength: "120", placeholder: "Your name as it should appear" }),
        field("contact", "Contact details (for manuscripts)", { placeholder: "Address, phone, email" }, { textarea: true }),
        field("target", "Word target", { type: "number", min: "0", step: "100" }, { onChange: W.renderTotal }),
        field("deadline", "Deadline", { type: "date" }, { onChange: W.renderTotal }),
        d.kind === "article" && field("embargo", "Embargo until", { type: "datetime-local" }),
        d.kind === "article" && el("label", { class: "wr-field" }, "Style guide", guide),
        el("div", { class: "wr-field" }, "Kind", el("span", {}, d.kind === "fiction" ? "Fiction" : "Article / nonfiction"))),
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "comment-action", onclick: () => {
          if (!confirm(`Delete the draft “${d.title}” and its versions, claims and feedback?`)) return;
          const all = W.drafts();
          all.splice(all.indexOf(d), 1);
          W.save();
          W.select(all[0]?.id || "");
        } }, "Delete draft")));
    box.addEventListener("toggle", () => { try { localStorage.setItem("wrDetailsOpen", box.open ? "1" : "0"); } catch {} });
    return box;
  }


  /* =========================================================
     BINDER
     ========================================================= */

  function binder(d, panel) {
    const sceneWord = d.kind === "fiction" ? "scene" : "section";
    const partWord = d.kind === "fiction" ? "chapter" : "part";
    const move = (list, i, delta) => { const [x] = list.splice(i, 1); list.splice(Math.max(0, Math.min(list.length, i + delta)), 0, x); W.save(); render(panel); };

    return el("nav", { class: "wr-binder", "aria-label": "Binder" },
      el("ol", { class: "wr-parts" }, d.parts.map((p, pi) => el("li", { class: "wr-part" },
        el("div", { class: "wr-part-head" },
          inlineTitle(p, `${partWord[0].toUpperCase() + partWord.slice(1)} ${pi + 1}`),
          el("span", { class: "wr-mini" },
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": `Move ${partWord} up`, disabled: pi === 0, onclick: () => move(d.parts, pi, -1) }, "↑"),
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": `Move ${partWord} down`, disabled: pi === d.parts.length - 1, onclick: () => move(d.parts, pi, 1) }, "↓"),
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": `Delete ${partWord}`, onclick: () => {
              const n = p.scenes.reduce((sum, s) => sum + words(s.text), 0);
              if (n && !confirm(`Delete “${p.title || partWord}” and its ${n} words?`)) return;
              d.parts.splice(pi, 1);
              if (!d.parts.length) d.parts.push({ id: newId("pt"), title: "", scenes: [] });
              W.save(); render(panel);
            } }, "×"))),
        el("ol", { class: "wr-scenes" }, p.scenes.map((s, si) => el("li", { class: `wr-scene-link${s.id === focusSceneId ? " is-current" : ""}` },
          el("button", { type: "button", class: "wr-scene-btn", onclick: () => { focusSceneId = s.id; if (view !== "write") { view = "write"; render(panel); } jumpTo(s.id); } },
            el("span", { class: `wr-dot is-${s.status.toLowerCase()}`, "aria-hidden": "true" }),
            s.title || `Untitled ${sceneWord}`,
            el("span", { class: "wr-count" }, words(s.text) ? ` ${words(s.text)}` : "")),
          el("span", { class: "wr-mini" },
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": `Move ${sceneWord} up`, onclick: () => {
              if (si > 0) return move(p.scenes, si, -1);
              if (pi > 0) { p.scenes.splice(si, 1); d.parts[pi - 1].scenes.push(s); W.save(); render(panel); }
            } }, "↑"),
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": `Move ${sceneWord} down`, onclick: () => {
              if (si < p.scenes.length - 1) return move(p.scenes, si, 1);
              if (pi < d.parts.length - 1) { p.scenes.splice(si, 1); d.parts[pi + 1].scenes.unshift(s); W.save(); render(panel); }
            } }, "↓"),
            el("button", { type: "button", class: "goal-item-remove wr-move", "aria-label": `Delete ${sceneWord}`, onclick: () => {
              if (words(s.text) && !confirm(`Delete “${s.title || sceneWord}” and its ${words(s.text)} words?`)) return;
              p.scenes.splice(si, 1); W.save(); render(panel);
            } }, "×"))))),
        el("button", { type: "button", class: "comment-action wr-add", onclick: () => {
          const s = blankScene(`${sceneWord[0].toUpperCase() + sceneWord.slice(1)} ${p.scenes.length + 1}`);
          p.scenes.push(s); focusSceneId = s.id; W.save(); render(panel); jumpTo(s.id);
        } }, `+ ${sceneWord}`)))),
      el("button", { type: "button", class: "small-btn wr-add-part", onclick: () => {
        d.parts.push({ id: newId("pt"), title: `${partWord[0].toUpperCase() + partWord.slice(1)} ${d.parts.length + 1}`, scenes: [blankScene(d.kind === "fiction" ? "Scene 1" : "Section 1")] });
        W.save(); render(panel);
      } }, `+ ${partWord}`));
  }

  const blankScene = (title) => ({ id: newId("sc"), title, text: "", synopsis: "", pov: "", setting: "", when: "", status: "Drafting", threads: [], passes: {}, notes: "" });

  function inlineTitle(obj, placeholder) {
    const input = el("input", { class: "wr-part-title", value: obj.title, placeholder, "aria-label": "Title" });
    input.addEventListener("input", () => { obj.title = input.value; W.save({ soon: true }); });
    return input;
  }

  function jumpTo(sceneId) {
    setTimeout(() => {
      const box = document.querySelector(`.wr-scene[data-id="${sceneId}"]`);
      box?.scrollIntoView({ behavior: "smooth", block: "start" });
      box?.querySelector("textarea")?.focus({ preventScroll: true });
    }, 30);
  }


  /* =========================================================
     WRITE VIEW: every scene, one after another
     ========================================================= */

  const grow = (t) => { t.style.height = "auto"; t.style.height = `${t.scrollHeight + 4}px`; };

  function writer(d) {
    return el("div", { class: "wr-writer" }, d.parts.map(p => el("section", { class: "wr-part-block" },
      d.parts.length > 1 && el("h2", { class: "wr-part-heading" }, p.title || "Untitled"),
      p.scenes.map(s => {
        const title = el("input", { class: "wr-scene-title", value: s.title, placeholder: "Title", "aria-label": "Scene title" });
        title.addEventListener("input", () => { s.title = title.value; W.save({ soon: true }); });
        const wordLabel = (n) => `${n} word${n === 1 ? "" : "s"}`;
        const count = el("span", { class: "wr-count" }, wordLabel(words(s.text)));
        const text = el("textarea", { class: "wr-text", spellcheck: "true", "aria-label": `Text of ${s.title || "scene"}`,
          placeholder: d.kind === "fiction" ? "Write the scene…" : "Write this section…" });
        text.value = s.text;
        text.addEventListener("input", () => { s.text = text.value; count.textContent = wordLabel(words(s.text)); grow(text); W.save({ soon: true }); });
        const remember = () => {
          const sel = text.value.slice(text.selectionStart, text.selectionEnd).trim();
          lastSelection = { sceneId: s.id, text: sel };
        };
        text.addEventListener("select", remember);
        text.addEventListener("keyup", remember);
        text.addEventListener("mouseup", remember);
        text.addEventListener("focus", () => {
          if (focusSceneId === s.id) return;
          focusSceneId = s.id;
          document.querySelectorAll(".wr-scene-link").forEach(li => li.classList.remove("is-current"));
          const box = document.querySelector(".wr-inspector");
          box?.replaceWith(inspector(d));
        });
        requestAnimationFrame(() => grow(text));
        return el("article", { class: "wr-scene", dataset: { id: s.id } },
          el("div", { class: "wr-scene-head" }, title, count),
          text);
      }))));
  }


  /* =========================================================
     INSPECTOR: the scene you're in
     ========================================================= */

  function inspector(d) {
    const found = W.scenes(d).find(x => x.scene.id === focusSceneId);
    if (!found) return el("aside", { class: "wr-inspector" }, el("p", { class: "media-muted" }, "Click into a scene to see its details."));
    const s = found.scene;
    const field = (key, label, { textarea = false, placeholder = "" } = {}) => {
      const input = textarea ? el("textarea", { rows: "3", placeholder }) : el("input", { placeholder });
      input.value = s[key] || "";
      input.addEventListener("input", () => { s[key] = input.value; W.save({ soon: true }); });
      return el("label", { class: "wr-field" }, label, input);
    };
    const status = el("select", { class: "team-select" }, W.SCENE_STATUSES.map(x => el("option", { value: x }, x)));
    status.value = s.status;
    status.addEventListener("change", () => { s.status = status.value; W.save(); });

    // Plot threads (fiction)
    const threads = d.kind === "fiction" && el("div", { class: "wr-field" }, "Plot threads",
      d.threads.length
        ? el("div", { class: "team-chips" }, d.threads.map(t => el("button", {
            type: "button", class: "team-chip team-chip--toggle", "aria-pressed": String(s.threads.includes(t.id)),
            onclick: (event) => {
              s.threads = s.threads.includes(t.id) ? s.threads.filter(x => x !== t.id) : [...s.threads, t.id];
              event.currentTarget.setAttribute("aria-pressed", String(s.threads.includes(t.id)));
              W.save();
            } }, t.name)))
        : el("span", { class: "media-muted" }, "Add threads on the Story tab."));

    // Story-bible names this scene mentions
    const bible = W.list("storyBible");
    const text = s.text.toLowerCase();
    const mentioned = bible.filter(b => [b.name, ...(b.aliases || [])].filter(Boolean).some(n => new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)));
    const claims = d.claims.filter(c => c.sceneId === s.id);

    return el("aside", { class: "wr-inspector", "aria-label": "Scene details" },
      el("h3", {}, s.title || "Untitled"),
      el("label", { class: "wr-field" }, "Status", status),
      field("synopsis", "Synopsis (shows on the corkboard)", { textarea: true }),
      d.kind === "fiction" && field("pov", "Point of view", { placeholder: "Whose eyes?" }),
      d.kind === "fiction" && field("setting", "Setting", { placeholder: "Where?" }),
      d.kind === "fiction" && field("when", "Story time", { placeholder: "e.g. Day 3, evening; 1987-05-04" }),
      threads,
      field("notes", "Notes", { textarea: true }),
      mentioned.length > 0 && el("div", { class: "wr-field" }, "In this scene",
        el("ul", { class: "team-chips" }, mentioned.map(b => el("li", { class: "team-chip", title: b.summary || "" }, b.name)))),
      d.kind === "article" && el("p", { class: "media-muted" }, claims.length
        ? `${claims.length} claim${claims.length === 1 ? "" : "s"} to check here (${claims.filter(c => c.status === "Verified").length} verified).`
        : "Select a sentence and click “Mark as claim” to add it to the fact-check list."));
  }


  /* =========================================================
     CORKBOARD
     ========================================================= */

  function corkboard(d, panel) {
    return el("div", { class: "wr-cork" }, d.parts.map(p => el("section", { class: "wr-cork-part" },
      el("h2", { class: "iv-h2" }, p.title || "Untitled"),
      el("div", { class: "wr-cork-grid" }, p.scenes.map((s, i) => {
        const syn = el("textarea", { rows: "4", placeholder: "What happens?", "aria-label": `Synopsis of ${s.title}` });
        syn.value = s.synopsis;
        syn.addEventListener("input", () => { s.synopsis = syn.value; W.save({ soon: true }); });
        return el("article", { class: `wr-card is-${s.status.toLowerCase()}` },
          el("header", {}, el("strong", {}, s.title || "Untitled"), el("span", { class: "pitch-pill" }, s.status)),
          syn,
          el("p", { class: "media-muted" }, [s.pov && `POV: ${s.pov}`, s.setting, `${words(s.text)} word${words(s.text) === 1 ? "" : "s"}`].filter(Boolean).join(" · ")),
          el("div", { class: "comment-actions" },
            el("button", { type: "button", class: "comment-action", "aria-label": "Move earlier", disabled: i === 0, onclick: () => { p.scenes.splice(i, 1); p.scenes.splice(i - 1, 0, s); W.save(); render(panel); } }, "←"),
            el("button", { type: "button", class: "comment-action", "aria-label": "Move later", disabled: i === p.scenes.length - 1, onclick: () => { p.scenes.splice(i, 1); p.scenes.splice(i + 1, 0, s); W.save(); render(panel); } }, "→"),
            el("button", { type: "button", class: "comment-action", onclick: () => { focusSceneId = s.id; view = "write"; render(panel); jumpTo(s.id); } }, "Write")));
      })))));
  }


  /* =========================================================
     TOOLS: claims, versions
     ========================================================= */

  function markClaim() {
    const d = W.current();
    if (!lastSelection?.text) { W.setStatus("Select the sentence or figure to check first, then click Mark as claim."); return; }
    d.claims.push({ id: newId("cl"), sceneId: lastSelection.sceneId, text: lastSelection.text.slice(0, 600), researchId: "", evidence: "", status: "Unchecked", notes: "" });
    W.save();
    W.setStatus(`Added to the fact-check list (Check tab): “${lastSelection.text.slice(0, 60)}${lastSelection.text.length > 60 ? "…" : ""}”`);
    lastSelection = null;
  }

  /* Starts a package on the Packaging page from the draft: headline, standfirst, keywords */
  function packageDraft(d) {
    const packages = W.list("packaging");
    const first = W.scenes(d).map(x => x.scene.text.trim()).find(Boolean) || "";
    const standfirst = first.split(/\n+/)[0].slice(0, 300);
    const tracker = Projects.getData("tracker", {}) || {};
    const keywords = String(tracker.taxonomy || "").split(",").map(t => t.trim()).filter(Boolean);
    const id = newId("pk");
    packages.push({
      id, name: d.title || "Article", platform: d.kind === "fiction" ? "zine" : "article", draftId: d.id,
      keyword: keywords[0] || "", keywords: keywords.slice(1), audience: "", notes: "",
      titles: [{ id: newId("t"), text: d.title || "", chosen: true }], thumbs: [], description: standfirst, tags: [], hashtags: [],
      images: [{ id: newId("a"), label: d.kind === "fiction" ? "Cover" : "Image 1", alt: "" }],
      seoTitle: "", metaDescription: standfirst.slice(0, 160), slug: "", shareTitle: "", shareDescription: "", previewText: "",
      deliverables: { done: {}, custom: [] }, created: Date.now(), updated: Date.now(),
    });
    W.saveList("packaging", packages);
    try { localStorage.setItem(`packagingCurrent:${Projects.activeId()}`, id); } catch {}
    location.href = "packaging.html";
  }

  function saveVersion(d) {
    const label = prompt("Name this version (e.g. “First draft”, “Sent to editor”):", `Version ${d.versions.length + 1}`);
    if (label == null) return;
    d.versions.push({ id: newId("v"), at: Date.now(), by: Projects.me() || "", label: label.trim() || `Version ${d.versions.length + 1}`, text: W.draftText(d), notes: "" });
    W.save();
    W.setStatus(`Saved “${label}”. Compare versions on the Revisions tab.`);
  }


  /* =========================================================
     EXPORT
     ========================================================= */

  function exportMenu(d) {
    const select = el("select", { class: "team-select", "aria-label": "Export" },
      el("option", { value: "" }, "Export…"),
      el("option", { value: "manuscript" }, "Manuscript format (.docx)"),
      el("option", { value: "docx" }, "Document (.docx)"),
      el("option", { value: "pdf" }, "PDF"),
      el("option", { value: "md" }, "Markdown (.md)"),
      el("option", { value: "txt" }, "Plain text (.txt)"));
    select.addEventListener("change", () => {
      const kind = select.value;
      select.value = "";
      if (!kind) return;
      const unchecked = d.claims.filter(c => c.status !== "Verified" && c.status !== "Cut").length;
      if (d.kind === "article" && unchecked && !confirm(`${unchecked} claim${unchecked === 1 ? " isn't" : "s aren't"} verified yet (Check tab). Export anyway?`)) return;
      const name = W.slug(d.title);
      if (kind === "manuscript") W.download(manuscriptDocx(d), `${name}-manuscript.docx`);
      if (kind === "docx") DocExport.downloadDocx(documentBlocks(d), { title: d.title, filename: `${name}.docx` });
      if (kind === "pdf") DocExport.print(documentBlocks(d), { title: d.title, font: "Georgia, serif" });
      if (kind === "md") W.download(new Blob([`# ${d.title}\n\n${d.byline ? `*${d.byline}*\n\n` : ""}${W.draftText(d)}\n`], { type: "text/markdown" }), `${name}.md`);
      if (kind === "txt") W.download(new Blob([`${d.title}\n${d.byline ? `${d.byline}\n` : ""}\n${W.draftText(d, { headings: false })}\n`], { type: "text/plain" }), `${name}.txt`);
    });
    return select;
  }

  const paragraphs = (text) => String(text).split(/\n+/).map(t => t.trim()).filter(Boolean);

  function documentBlocks(d) {
    const blocks = [{ t: "title", text: d.title || "Untitled" }];
    const meta = [d.byline && `By ${d.byline}`, d.embargo && `Embargoed until ${new Date(d.embargo).toLocaleString()}`].filter(Boolean).join(" · ");
    if (meta) blocks.push({ t: "meta", text: meta });
    d.parts.forEach(p => {
      if (d.parts.length > 1 && p.title) blocks.push({ t: "h1", text: p.title });
      let wrote = false;
      p.scenes.forEach(s => {
        const paras = paragraphs(s.text);
        if (!paras.length) return;
        if (d.kind === "fiction" && wrote) blocks.push({ t: "p", text: "#" });
        paras.forEach(text => blocks.push({ t: "p", text }));
        wrote = true;
      });
    });
    return blocks;
  }

  /* Standard manuscript format: Times New Roman 12, double spaced, 1" margins,
     contact details and word count on page one, "Surname / Title / page" header
     on later pages, scene breaks as "#", chapters on new pages, END at the end. */
  function manuscriptDocx(d) {
    const x = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    const run = (t) => `<w:r><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
    const p = (inner, { align = null, indent = true, single = false, before = 0, pageBreak = false } = {}) =>
      `<w:p><w:pPr>${pageBreak ? "<w:pageBreakBefore/>" : ""}<w:spacing w:before="${before}" w:after="0" w:line="${single ? 240 : 480}" w:lineRule="auto"/>` +
      `${indent ? '<w:ind w:firstLine="720"/>' : ""}${align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>${inner}</w:p>`;

    const total = W.draftWords(d);
    const rounded = total < 17500 ? Math.max(100, Math.round(total / 100) * 100) : Math.round(total / 1000) * 1000;
    const author = d.byline || Projects.me() || "Author";
    const surname = author.trim().split(/\s+/).pop();
    const shortTitle = (d.title || "Untitled").toUpperCase().split(/\s+/).slice(0, 4).join(" ");
    const novel = d.kind === "fiction" && (d.parts.length > 1 || total >= 17500);
    const contact = paragraphs(d.contact);

    let body = "";
    // Page one: contact block (left) and word count (right), in a table without borders
    const cell = (inner, width, align) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${inner}</w:tc>`;
    body += `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid><w:gridCol w:w="6360"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>` +
      cell([author, ...contact].map(line => p(run(line), { indent: false, single: true })).join(""), 6360) +
      cell(p(run(`about ${rounded.toLocaleString()} words`), { indent: false, single: true, align: "right" }), 3000) +
      `</w:tr></w:tbl>`;
    // Title about halfway down
    body += p(run(d.title || "Untitled"), { align: "center", indent: false, before: 3600 });
    body += p(run(`by ${author}`), { align: "center", indent: false });

    d.parts.forEach((part, pi) => {
      if (novel) {
        body += p(run(part.title || `Chapter ${pi + 1}`), { align: "center", indent: false, pageBreak: true, before: 2880 });
        body += p("", { indent: false });
      } else if (d.parts.length > 1 && part.title) {
        body += p(run(part.title), { align: "center", indent: false, before: 240 });
      }
      // Scene breaks (#) between scenes with text, in fiction only
      let wrote = false;
      part.scenes.forEach(s => {
        const paras = paragraphs(s.text);
        if (!paras.length) return;
        if (wrote && d.kind === "fiction") body += p(run("#"), { align: "center", indent: false });
        paras.forEach(t => { body += p(run(t)); });
        wrote = true;
      });
    });
    body += p(run("END"), { align: "center", indent: false });

    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
      { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>` },
      { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="480" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>` },
      { name: "word/header1.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>${run(`${surname} / ${shortTitle} / `)}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:hdr>` },
      { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr></w:body>
</w:document>` },
    ];
    return new Blob([Zip.create(files)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  W.register("draft", { render });
  W.manuscriptDocx = manuscriptDocx;
})();
