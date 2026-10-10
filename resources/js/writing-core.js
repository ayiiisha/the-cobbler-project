/* =========================================================
   writing-core.js — the Writing page: shared state and tabs
   ---------------------------------------------------------
   Tools for writers of articles, nonfiction and fiction. The
   page has seven tabs, each in its own file:
     Draft      writing-draft.js      binder, editor, corkboard, export
     Check      writing-check.js      fact-check claims, quote checker, style
     Story      writing-story.js      story bible, plot threads, story timeline
     Reporting  writing-reporting.js  sources, records requests, event timeline
     Revisions  writing-revisions.js  versions and tracked changes, feedback,
                                      revision passes, legal review, corrections
     Business   writing-business.js   submissions, queries, invoices
     Goals      writing-business.js   daily word goal, streak, history

   Saved inside the active project:
     project.data.drafts = [{
       id, title, kind: "article" | "fiction", byline, contact, target, deadline, embargo,
       styleGuide: "AP" | "Chicago", banned: [words], status,
       parts: [{ id, title, scenes: [{ id, title, text, synopsis, pov, setting, when,
                                       status, threads: [ids], passes: { passId: true }, notes }] }],
       threads: [{ id, name }],
       claims: [{ id, sceneId, text, researchId, evidence, status, notes }],
       versions: [{ id, at, by, label, text, notes }],
       feedback: [{ id, reader, round, sceneId, note, status, at }],
       legal: { checkId: true },
       created, updated,
     }]
     project.data.storyBible, sourceLog, recordsRequests, eventTimeline,
     submissions, corrections   (lists; see each tab's file)
     project.data.writingLog = [{ id: "<person>|<date>", person, date, words }]

   Fiction "parts" are chapters holding scenes; for articles
   they're parts holding sections.

   Needs projects-core.js.
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

  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const words = (text) => (String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const pad = (n) => String(n).padStart(2, "0");
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : String(iso);
  };
  const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft";

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let statusTimer = 0;
  function setStatus(message) {
    $("wr-status").textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { $("wr-status").textContent = ""; }, 8000);
  }


  /* =========================================================
     TEMPLATES (beat sheets and article structures)
     Each: parts with their scenes or sections.
     ========================================================= */

  const TEMPLATES = {
    article: {
      blank: { name: "Blank", parts: [["Article", ["Untitled section"]]] },
      pyramid: { name: "Inverted pyramid (news)", parts: [["Article", ["Lede", "Nut graf", "Key facts and quotes", "Supporting detail", "Background"]]] },
      feature: { name: "Feature", parts: [["Feature", ["Scene-setting lede", "Nut graf", "The story so far", "The turn", "What it means", "Kicker"]]] },
      explainer: { name: "Explainer", parts: [["Explainer", ["What happened", "Why it matters", "How we got here", "What people disagree about", "What's next"]]] },
      profile: { name: "Profile", parts: [["Profile", ["Opening scene", "Who they are", "What they want", "What stands in the way", "Where they are now"]]] },
      investigation: { name: "Investigation", parts: [["Investigation", ["Lede: the finding", "Nut graf", "The evidence", "How it happened", "The response", "What happens now"]]] },
      essay: { name: "Personal essay", parts: [["Essay", ["Hook", "Context", "Complication", "Turn", "Reflection"]]] },
      book: { name: "Nonfiction book", parts: [["Introduction", ["Introduction"]], ["Chapter 1", ["Opening"]], ["Chapter 2", ["Opening"]], ["Conclusion", ["Conclusion"]]] },
    },
    fiction: {
      blank: { name: "Blank", parts: [["Chapter 1", ["Scene 1"]]] },
      threeActs: { name: "Three acts", parts: [
        ["Act one", ["Setup", "Inciting incident", "Plot point one"]],
        ["Act two", ["Rising action", "Midpoint", "Plot point two"]],
        ["Act three", ["Climax", "Resolution"]]] },
      saveTheCat: { name: "Save the Cat (15 beats)", parts: [
        ["Act one", ["Opening image", "Theme stated", "Set-up", "Catalyst", "Debate"]],
        ["Act two", ["Break into two", "B story", "Fun and games", "Midpoint", "Bad guys close in", "All is lost", "Dark night of the soul"]],
        ["Act three", ["Break into three", "Finale", "Final image"]]] },
      herosJourney: { name: "Hero's Journey (12 stages)", parts: [
        ["Departure", ["Ordinary world", "Call to adventure", "Refusal of the call", "Meeting the mentor", "Crossing the threshold"]],
        ["Initiation", ["Tests, allies, enemies", "Approach to the inmost cave", "The ordeal", "Reward"]],
        ["Return", ["The road back", "Resurrection", "Return with the elixir"]]] },
      kishotenketsu: { name: "Kishōtenketsu (4 parts)", parts: [
        ["Ki: introduction", ["Introduction"]], ["Shō: development", ["Development"]],
        ["Ten: twist", ["Twist"]], ["Ketsu: reconciliation", ["Reconciliation"]]] },
      shortStory: { name: "Short story", parts: [["Story", ["Opening", "Complication", "Crisis", "Climax", "Ending"]]] },
    },
  };

  const SCENE_STATUSES = ["Idea", "Drafting", "Revising", "Done"];


  /* =========================================================
     DATA
     ========================================================= */

  function normalize(d) {
    d.kind = d.kind === "fiction" ? "fiction" : "article";
    for (const k of ["title", "byline", "contact", "deadline", "embargo", "status"]) d[k] ??= "";
    d.styleGuide = d.styleGuide === "Chicago" ? "Chicago" : "AP";
    for (const k of ["banned", "parts", "threads", "claims", "versions", "feedback"]) d[k] = Array.isArray(d[k]) ? d[k] : [];
    d.legal = d.legal && typeof d.legal === "object" ? d.legal : {};
    d.parts.forEach(p => {
      p.title ??= "";
      p.scenes = Array.isArray(p.scenes) ? p.scenes : [];
      p.scenes.forEach(s => {
        for (const k of ["title", "text", "synopsis", "pov", "setting", "when", "notes"]) s[k] ??= "";
        s.status = SCENE_STATUSES.includes(s.status) ? s.status : "Drafting";
        s.threads = Array.isArray(s.threads) ? s.threads : [];
        s.passes = s.passes && typeof s.passes === "object" ? s.passes : {};
      });
    });
    if (!d.parts.length) d.parts.push({ id: newId("pt"), title: d.kind === "fiction" ? "Chapter 1" : "Article", scenes: [] });
    return d;
  }

  let drafts = (() => { const v = Projects.getData("drafts", []); return Array.isArray(v) ? v : []; })().map(normalize);
  const CURRENT_KEY = `writingCurrent:${Projects.activeId()}`;
  let currentId = (() => { try { return localStorage.getItem(CURRENT_KEY); } catch { return null; } })();
  const current = () => drafts.find(d => d.id === currentId) || drafts[0] || null;

  let saveTimer = 0;
  function save({ soon = false } = {}) {
    clearTimeout(saveTimer);
    const write = () => {
      saveTimer = 0;
      const d = current();
      if (d) d.updated = Date.now();
      Projects.setData("drafts", drafts);
      logWords();
      renderTotal();
    };
    if (soon) saveTimer = setTimeout(write, 600); else write();
  }
  window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); Projects.setData("drafts", drafts); logWords(); } });

  // Other lists (sources, requests…): read and save by key
  const list = (key) => { const v = Projects.getData(key, []); return Array.isArray(v) ? v : []; };
  const saveList = (key, value) => Projects.setData(key, value);

  // Every scene in reading order, with its part
  const scenes = (d) => (d?.parts || []).flatMap(p => p.scenes.map(s => ({ part: p, scene: s })));
  const draftWords = (d) => scenes(d).reduce((n, { scene }) => n + words(scene.text), 0);

  // The whole draft as plain text (for versions, checks, export)
  function draftText(d, { headings = true } = {}) {
    return d.parts.map(p => [
      headings && d.parts.length > 1 && p.title ? `# ${p.title}` : "",
      p.scenes.map(s => [headings && s.title ? `## ${s.title}` : "", s.text.trim()].filter(Boolean).join("\n\n")).filter(Boolean).join("\n\n"),
    ].filter(Boolean).join("\n\n")).filter(Boolean).join("\n\n");
  }

  function fromTemplate(kind, templateId) {
    const t = TEMPLATES[kind][templateId] || TEMPLATES[kind].blank;
    return t.parts.map(([title, sceneTitles]) => ({
      id: newId("pt"), title,
      scenes: sceneTitles.map(st => ({ id: newId("sc"), title: st, text: "", synopsis: "", pov: "", setting: "", when: "", status: "Idea", threads: [], passes: {}, notes: "" })),
    }));
  }


  /* =========================================================
     WORDS WRITTEN TODAY (Goals tab)
     Only increases count, so cutting text doesn't lose your day.
     ========================================================= */

  const LAST_TOTAL_KEY = `writingLastTotal:${Projects.activeId()}`;
  function totalWords() { return drafts.reduce((n, d) => n + draftWords(d), 0); }
  function logWords() {
    const total = totalWords();
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LAST_TOTAL_KEY)); } catch {}
    try { localStorage.setItem(LAST_TOTAL_KEY, JSON.stringify(total)); } catch {}
    if (last == null || total <= last) return;
    const person = Projects.me() || "Me";
    const log = list("writingLog");
    const id = `${person}|${todayISO()}`;
    const entry = log.find(e => e.id === id);
    if (entry) entry.words += total - last;
    else log.push({ id, person, date: todayISO(), words: total - last });
    saveList("writingLog", log);
  }
  // Start counting from what's here now, so words that arrived from collaborators aren't counted as yours
  (() => { try { localStorage.setItem(LAST_TOTAL_KEY, JSON.stringify(totalWords())); } catch {} })();


  /* =========================================================
     TABS
     ========================================================= */

  const tabs = {};
  let tab = (location.hash.slice(1) || "draft");

  function show(name) {
    if (!tabs[name]) name = "draft";
    tab = name;
    document.querySelectorAll("#wr-tabs [role=tab]").forEach(b => {
      const on = b.dataset.tab === name;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    history.replaceState(null, "", name === "draft" ? location.pathname : `#${name}`);
    const panel = $("wr-panel");
    tabs[name].render(panel);
  }

  function renderTop() {
    const select = $("wr-draft");
    select.replaceChildren(...(drafts.length
      ? drafts.map(d => el("option", { value: d.id }, `${d.title || "Untitled"} (${d.kind === "fiction" ? "fiction" : "article"})`))
      : [el("option", { value: "" }, "No drafts yet")]));
    select.value = current()?.id || "";
    const claim = $("wr-claim");
    claim.replaceChildren(current() && window.ProjectShare?.claimButton ? ProjectShare.claimButton(current().id, current().title) : "");
    renderTotal();
  }

  function renderTotal() {
    const d = current();
    if (!d) { $("wr-total").textContent = ""; return; }
    const n = draftWords(d);
    const target = Number(d.target) || 0;
    const due = d.deadline ? ` · due ${fmtDate(d.deadline)}` : "";
    $("wr-total").textContent = `${n.toLocaleString()} word${n === 1 ? "" : "s"}${target ? ` of ${target.toLocaleString()} (${Math.min(100, Math.round(n / target * 100))}%)` : ""}${due}`;
  }

  function select(id) {
    currentId = id;
    try { localStorage.setItem(CURRENT_KEY, id); } catch {}
    renderTop();
    show(tab);
  }

  function setUpDialog() {
    const dialog = $("wr-dialog");
    const form = $("wr-form");
    const fillTemplates = () => {
      const kind = form.elements.kind.value;
      $("wr-template").replaceChildren(...Object.entries(TEMPLATES[kind]).map(([id, t]) => el("option", { value: id }, t.name)));
    };
    form.querySelectorAll("[name=kind]").forEach(r => r.addEventListener("change", fillTemplates));
    $("wr-new").addEventListener("click", () => { form.reset(); fillTemplates(); dialog.showModal(); });
    $("wr-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const kind = String(data.get("kind"));
      const d = normalize({
        id: newId("dr"), title: String(data.get("title")).trim(), kind,
        target: Number(data.get("target")) || 0, deadline: String(data.get("deadline") || ""),
        byline: Projects.me(), parts: fromTemplate(kind, String(data.get("template"))),
        created: Date.now(), updated: Date.now(),
      });
      drafts.push(d);
      save();
      dialog.close();
      select(d.id);
      show("draft");
    });
  }

  window.WritingPage = {
    el, $, newId, words, todayISO, fmtDate, slug, download, setStatus,
    TEMPLATES, SCENE_STATUSES, fromTemplate, normalize,
    drafts: () => drafts, current, save, list, saveList, scenes, draftWords, draftText, totalWords,
    register(name, t) { tabs[name] = t; },
    // replaceChildren that skips false/empty parts (for "cond && el(...)")
    fill(panel, ...nodes) { panel.replaceChildren(...nodes.flat().filter(n => n != null && n !== false && n !== "")); },
    show, renderTop, renderTotal, select,
    tab: () => tab,
  };

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    $("wr-draft").addEventListener("change", (event) => select(event.target.value));
    const buttons = [...document.querySelectorAll("#wr-tabs [role=tab]")];
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => show(b.dataset.tab));
      b.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const next = buttons[(i + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
        next.focus(); next.click();
      });
    });
    renderTop();
    show(tab);

    // Transcripts kept outside the project finish loading in the background
    // (media-core.js): the quote checker needs their words
    document.addEventListener("transcripts-loaded", () => { if (tab === "check") show("check"); });
  });
})();
