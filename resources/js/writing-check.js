/* =========================================================
   writing-check.js — the Check tab of the Writing page
   ---------------------------------------------------------
   • Fact-check: claims marked in the draft (Draft › Mark as
     claim), each linked to a Research note or other evidence,
     with a status. Exports warn while any are unverified.
   • Quote checker: every quotation in the draft compared with
     the transcripts on Media & Transcripts: exact, close (check
     the wording) or not found.
   • Style and readability: reading ease and grade level, long
     sentences, passive voice, adverbs, clichés, your banned
     words, and a few AP or Chicago rules (numbers, months, times,
     serial commas, dashes). Fiction adds dialogue-tag checks.
   All run here in the browser; nothing is sent anywhere.

   Needs writing-core.js (and media-core.js for the quote checker).
   ========================================================= */
(() => {

  const W = window.WritingPage;
  if (!W) return;
  const { el, newId } = W;

  const CLAIM_STATUSES = ["Unchecked", "Verified", "Disputed", "Cut"];

  /* Finds text in the draft: opens the Draft tab and selects it */
  W.findText = (text, sceneId = null) => {
    W.show("draft");
    setTimeout(() => {
      const boxes = [...document.querySelectorAll(".wr-scene")];
      const box = boxes.find(b => (!sceneId || b.dataset.id === sceneId) && b.querySelector("textarea").value.includes(text))
        || boxes.find(b => b.querySelector("textarea").value.includes(text));
      const area = box?.querySelector("textarea");
      if (!area) { W.setStatus("That text isn't in the draft any more."); return; }
      const at = area.value.indexOf(text);
      box.scrollIntoView({ block: "center" });
      area.focus();
      area.setSelectionRange(at, at + text.length);
    }, 30);
  };

  function render(panel) {
    const d = W.current();
    if (!d) { panel.replaceChildren(el("p", { class: "media-empty" }, "Start a draft first.")); return; }
    W.fill(panel,
      d.kind === "article" && claimsSection(d, panel),
      d.kind === "article" && quotesSection(d),
      styleSection(d, panel));
  }


  /* =========================================================
     FACT-CHECK
     ========================================================= */

  function claimsSection(d, panel) {
    const research = W.list("research");
    const verified = d.claims.filter(c => c.status === "Verified").length;
    const open = d.claims.filter(c => c.status === "Unchecked" || c.status === "Disputed").length;
    const scenes = W.scenes(d);
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" },
        el("h2", {}, "Fact-check"),
        el("span", { class: `pk-count${open ? " is-long" : ""}` }, `${verified} of ${d.claims.length} verified`)),
      el("p", { class: "media-tip" }, "Select a sentence in the draft and click “Mark as claim”, or add one here. Link each to a Research note (with its sources) or write down the evidence."),
      d.claims.length ? el("ol", { class: "wr-claims" }, d.claims.map((c, i) => {
        const status = el("select", { class: `research-status-select is-${c.status.toLowerCase()}`, "aria-label": "Status" }, CLAIM_STATUSES.map(s => el("option", { value: s }, s)));
        status.value = c.status;
        status.addEventListener("change", () => { c.status = status.value; W.save(); render(panel); });
        const link = el("select", { class: "team-select", "aria-label": "Research note" },
          el("option", { value: "" }, research.length ? "Link a Research note…" : "No Research notes yet"),
          research.map(r => el("option", { value: r.id }, `${r.title || "Untitled"} (${r.status || "Unverified"})`)));
        link.value = c.researchId || "";
        link.addEventListener("change", () => { c.researchId = link.value; W.save(); render(panel); });
        const note = research.find(r => r.id === c.researchId);
        const evidence = el("input", { value: c.evidence || "", placeholder: "Evidence: document, link, transcript 00:12:30, phone call…", "aria-label": "Evidence" });
        evidence.addEventListener("input", () => { c.evidence = evidence.value; W.save({ soon: true }); });
        const text = el("textarea", { rows: "2", "aria-label": "Claim" });
        text.value = c.text;
        text.addEventListener("input", () => { c.text = text.value; W.save({ soon: true }); });
        const where = scenes.find(x => x.scene.id === c.sceneId)?.scene.title;
        return el("li", { class: `wr-claim is-${c.status.toLowerCase()}` },
          el("div", { class: "wr-claim-head" }, status, where && el("span", { class: "media-muted" }, where),
            el("span", { class: "comment-actions" },
              el("button", { type: "button", class: "comment-action", onclick: () => W.findText(c.text, c.sceneId) }, "Find in draft"),
              el("button", { type: "button", class: "comment-action", onclick: () => { d.claims.splice(i, 1); W.save(); render(panel); } }, "Remove"))),
          text, link,
          note && el("p", { class: "media-muted" }, `Research: ${note.status || "Unverified"}${(note.sources || []).length ? ` · sources: ${(note.sources || []).join("; ")}` : ""}`),
          evidence);
      })) : el("p", { class: "media-empty" }, "No claims marked yet."),
      el("button", { type: "button", class: "small-btn", onclick: () => {
        d.claims.push({ id: newId("cl"), sceneId: "", text: "", researchId: "", evidence: "", status: "Unchecked", notes: "" });
        W.save(); render(panel);
      } }, "+ Claim"));
  }


  /* =========================================================
     QUOTE CHECKER
     ========================================================= */

  const norm = (t) => String(t).toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);

  function quotesIn(text) {
    const out = [];
    const re = /[“"]([^”"\n]{12,600})[”"]/g;
    let m;
    while ((m = re.exec(text))) if (norm(m[1]).length >= 4) out.push(m[1].trim());
    return [...new Set(out)];
  }

  function checkQuote(quote, transcripts) {
    const q = norm(quote);
    let best = null;
    for (const t of transcripts) {
      // Every word in the transcript, with the paragraph it's in
      const tw = [], at = [];
      t.segments.forEach((s, i) => norm(s.text).forEach(w => { tw.push(w); at.push(i); }));
      if (tw.length < q.length) continue;
      // Exact
      for (let i = 0; i + q.length <= tw.length; i++) {
        if (tw[i] !== q[0]) continue;
        let ok = true;
        for (let j = 1; j < q.length; j++) if (tw[i + j] !== q[j]) { ok = false; break; }
        if (ok) return { kind: "exact", transcript: t, segment: t.segments[at[i]], score: 1 };
      }
      // Close: the window sharing the most words
      const need = new Map();
      q.forEach(w => need.set(w, (need.get(w) || 0) + 1));
      const have = new Map();
      let hits = 0;
      const add = (w, n) => {
        const before = Math.min(have.get(w) || 0, need.get(w) || 0);
        have.set(w, (have.get(w) || 0) + n);
        hits += Math.min(have.get(w), need.get(w) || 0) - before;
      };
      for (let i = 0; i < tw.length; i++) {
        add(tw[i], 1);
        if (i >= q.length) add(tw[i - q.length], -1);
        if (i >= q.length - 1) {
          const score = hits / q.length;
          if (!best || score > best.score) best = { kind: "close", transcript: t, segment: t.segments[at[i - Math.floor(q.length / 2)]], score, words: tw.slice(i - q.length + 1, i + 1).join(" ") };
        }
      }
    }
    return best && best.score >= 0.6 ? best : { kind: "none", score: best?.score || 0 };
  }

  function quotesSection(d) {
    const media = window.MediaCore ? MediaCore.loadMedia() : { transcripts: [], clips: [] };
    const quotes = quotesIn(W.draftText(d, { headings: false }));
    const box = el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Quote checker")),
      el("p", { class: "media-tip" }, `Compares every quotation in the draft with the ${media.transcripts.length} transcript${media.transcripts.length === 1 ? "" : "s"} on Media & Transcripts.`));
    if (!quotes.length) { box.append(el("p", { class: "media-empty" }, "No quotations in the draft yet (text in “quote marks”, four words or more).")); return box; }
    if (!media.transcripts.length) { box.append(el("p", { class: "media-empty" }, `${quotes.length} quotation${quotes.length === 1 ? "" : "s"} found, but there are no transcripts to check them against. Import them on Media & Transcripts.`)); return box; }
    // Who each quote is attributed to: a source named in the same paragraph
    const sources = W.list("sourceLog").filter(x => x.name?.trim());
    const text = W.draftText(d, { headings: false });
    // The words around a quote that name its speaker: the rest of its sentence ("…," said Sam), else the lead-in
    const around = (q) => {
      const at = text.indexOf(q);
      if (at < 0) return ["", ""];
      const end = at + q.length;
      const stop = text.slice(end).search(/[.!?](?=\s|$)|\n/);
      const after = text.slice(end, end + (stop >= 0 ? stop + 1 : 160));
      const start = Math.max(text.lastIndexOf(".", at - 2), text.lastIndexOf("\n", at), 0);
      return [after, text.slice(start, at)];
    };
    const namesOf = (src) => { const parts = src.name.trim().split(/\s+/); return [src.name.trim(), parts.length > 1 && parts[parts.length - 1].length >= 3 ? parts[parts.length - 1] : null].filter(Boolean); };
    const results = quotes.map(q => {
      const named = (part) => sources.find(x => namesOf(x).some(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(part)));
      const [after, before] = around(q);
      const src = named(after) || named(before);
      const theirs = src ? media.transcripts.filter(t => (src.transcriptIds || []).includes(t.id)) : [];
      if (src && theirs.length) {
        const own = checkQuote(q, theirs);
        if (own.kind !== "none") return { q, r: own, src, attribution: "ok" };
        const elsewhere = checkQuote(q, media.transcripts.filter(t => !theirs.includes(t)));
        return { q, r: elsewhere, src, attribution: elsewhere.kind !== "none" ? "other" : "missing" };
      }
      return { q, r: checkQuote(q, media.transcripts), src };
    });
    const counts = { exact: 0, close: 0, none: 0 };
    results.forEach(x => counts[x.r.kind]++);
    box.append(el("p", {}, `${counts.exact} word for word · ${counts.close} close (check the wording) · ${counts.none} not found`),
      el("ol", { class: "wr-quotes" }, results.map(({ q, r, src, attribution }) => {
        const clip = r.transcript ? MediaCore.clipFor(media, r.transcript) : null;
        const tc = r.segment ? MediaCore.toTimecode((clip?.tcStart || 0) + r.segment.start, clip?.fps || media.fps) : "";
        const who = r.segment ? MediaCore.speakerName(r.transcript, r.segment.speaker) : "";
        return el("li", { class: `wr-quote is-${r.kind}` },
          el("span", { class: "wr-quote-badge" }, r.kind === "exact" ? "✓ Word for word" : r.kind === "close" ? `≈ Close (${Math.round(r.score * 100)}%)` : "✗ Not found"),
          el("q", {}, q),
          r.kind !== "none" && el("span", { class: "media-muted" }, `${who} · ${r.transcript.title} · ${tc}`),
          attribution === "ok" && el("span", { class: "wr-quote-said" }, `✓ Attributed to ${src.name}, and it's in their interview.`),
          attribution === "other" && el("span", { class: "wr-thread-flag" }, `⚠ Attributed to ${src.name}, but it matches ${r.transcript.title}, not their transcripts. Check who said it.`),
          attribution === "missing" && el("span", { class: "wr-thread-flag" }, `Attributed to ${src.name}, but it isn't in their transcripts.`),
          r.kind === "close" && el("span", { class: "wr-quote-said" }, `Transcript: “${r.words}”`),
          el("button", { type: "button", class: "comment-action", onclick: () => W.findText(q) }, "Find in draft"));
      })));
    return box;
  }


  /* =========================================================
     STYLE AND READABILITY
     ========================================================= */

  const CLICHES = ["at the end of the day", "in this day and age", "only time will tell", "the calm before the storm", "a perfect storm",
    "think outside the box", "low-hanging fruit", "game changer", "game-changer", "paradigm shift", "few and far between", "last but not least",
    "it goes without saying", "needle in a haystack", "tip of the iceberg", "when all is said and done", "a whole new ball game", "move the needle",
    "first and foremost", "each and every", "in the wake of", "sent shockwaves"];
  const FILLERS = ["very", "really", "just", "quite", "actually", "basically", "literally", "somewhat", "rather", "totally"];
  const MONTHS = ["January", "February", "August", "September", "October", "November", "December"];
  const AP_MONTH = { January: "Jan.", February: "Feb.", August: "Aug.", September: "Sept.", October: "Oct.", November: "Nov.", December: "Dec." };

  function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function readability(text) {
    const sentences = text.split(/(?<=[.!?])\s+(?=[“"‘'(\[]?[A-Z0-9])/).map(s => s.trim()).filter(s => W.words(s) > 0);
    const allWords = text.match(/[\p{L}][\p{L}'’-]*/gu) || [];
    const syl = allWords.reduce((n, w) => n + syllables(w), 0);
    const nW = allWords.length || 1, nS = sentences.length || 1;
    return {
      sentences, words: allWords.length,
      ease: Math.round(206.835 - 1.015 * (nW / nS) - 84.6 * (syl / nW)),
      grade: Math.max(0, Math.round((0.39 * (nW / nS) + 11.8 * (syl / nW) - 15.59) * 10) / 10),
      avg: Math.round(nW / nS * 10) / 10,
    };
  }

  /* Rules: each finds matches in the text and says what to do */
  function rulesFor(d) {
    const rules = [
      { id: "long", name: "Long sentences (over 30 words)", find: (t, r) => r.sentences.filter(s => W.words(s) > 30) },
      { id: "passive", name: "Possible passive voice", tip: "Who did it? Active verbs are clearer.",
        find: (t) => t.match(/\b(?:is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b(?:\s+by\b)?/gi) || [] },
      { id: "adverbs", name: "Adverbs ending in -ly", tip: "Often a stronger verb does the job.",
        find: (t) => (t.match(/\b\w{3,}ly\b/gi) || []).filter(w => !/^(only|early|family|reply|supply|apply|daily|likely|july|italy|holy|ugly|silly|belly|jelly|rally|ally|fly|lonely|lovely|friendly|elderly|bully|curly|hilly|holly|lily|wholly|emily|kelly|sally|billy|molly|polly|rely|imply|comply|multiply|monthly|weekly|yearly|nightly|hourly|costly|deadly|orderly|scholarly|burly|surly|chilly|frilly|gully|tally)$/i.test(w)) },
      { id: "fillers", name: "Filler words", find: (t) => t.match(new RegExp(`\\b(?:${FILLERS.join("|")})\\b`, "gi")) || [] },
      { id: "cliches", name: "Clichés", find: (t) => CLICHES.flatMap(c => t.match(new RegExp(`\\b${c.replace(/[-]/g, "[- ]")}\\b`, "gi")) || []) },
      { id: "banned", name: "Your banned words", find: (t) => d.banned.flatMap(b => b.trim() ? (t.match(new RegExp(`\\b${b.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi")) || []) : []) },
      { id: "doublespace", name: "Double spaces", find: (t) => t.match(/[^\s] {2,}[^\s]/g) || [] },
      { id: "repeat", name: "Repeated words", find: (t) => (t.match(/\b(\w+)\s+\1\b/gi) || []).filter(m => !/^(had had|that that)$/i.test(m)) },
    ];
    if (d.kind === "article" && d.styleGuide === "AP") rules.push(
      { id: "ap-numbers", name: "AP: spell out one to nine", tip: "Except ages, percentages, dimensions, money, times and dates.",
        find: (t) => (t.match(/(?<![\d$£€.,:/-])(?<!(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s)\b[1-9]\b(?![\d%.,:/-]|\s*(?:percent|%|years?\s+old|-year|a\.m\.|p\.m\.|am\b|pm\b|inches|feet|foot|miles?|million|billion))/gi) || []) },
      { id: "ap-months", name: "AP: abbreviate months with dates", tip: "Jan., Feb., Aug., Sept., Oct., Nov., Dec. before a date.",
        find: (t) => t.match(new RegExp(`\\b(?:${MONTHS.join("|")})\\s+\\d{1,2}\\b`, "g")) || [], fix: (m) => m.replace(/^\w+/, w => AP_MONTH[w] || w) },
      { id: "ap-times", name: "AP: write times as a.m. / p.m.", find: (t) => t.match(/\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm|A\.M\.|P\.M\.)(?![.\w])/g) || [] },
      { id: "ap-serial", name: "AP: no serial (Oxford) comma in simple lists", find: (t) => t.match(/\b\w+, \w+(?: \w+)?, (?:and|or) \w+/g) || [] },
      { id: "ap-dash", name: "AP: spaces around dashes", find: (t) => t.match(/\w—\w/g) || [] });
    if (d.kind === "article" && d.styleGuide === "Chicago") rules.push(
      { id: "cmos-serial", name: "Chicago: use the serial (Oxford) comma", find: (t) => t.match(/\b\w+, \w+ (?:and|or) \w+\b/g) || [] },
      { id: "cmos-dash", name: "Chicago: no spaces around em dashes", find: (t) => t.match(/\w —|— \w/g) || [] },
      { id: "cmos-numbers", name: "Chicago: spell out zero to one hundred", tip: "In general writing.", find: (t) => t.match(/(?<![\d$£€.,:/-])(?<!(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s)\b(?:[0-9]|[1-9][0-9]|100)\b(?![\d%.,:/-]|\s*(?:percent|%))/g) || [] });
    if (d.kind === "fiction") rules.push(
      { id: "tags", name: "Fancy dialogue tags", tip: "“Said” disappears; others draw attention.",
        find: (t) => t.match(/[”"]\s*,?\s*(?:he|she|they|I|\w+)\s+(?:exclaimed|retorted|interjected|queried|hissed|growled|snarled|chortled|opined|ejaculated|expostulated|quipped|bellowed)\b/gi) || [] },
      { id: "saidly", name: "“Said” plus an adverb", find: (t) => t.match(/\bsaid\s+\w+ly\b/gi) || [] },
      { id: "filter", name: "Filter words (felt, saw, heard, noticed…)", tip: "Show the thing itself instead of the character noticing it.",
        find: (t) => t.match(/\b(?:felt|saw|heard|noticed|realized|realised|wondered|watched|seemed)\b/gi) || [] },
      { id: "suddenly", name: "“Suddenly” and friends", find: (t) => t.match(/\b(?:suddenly|all of a sudden|out of nowhere)\b/gi) || [] });
    return rules;
  }

  let scope = "draft";   // "draft" or a scene id
  function styleSection(d, panel) {
    const sceneList = W.scenes(d);
    const text = scope === "draft" ? W.draftText(d, { headings: false }) : sceneList.find(x => x.scene.id === scope)?.scene.text || "";
    const r = readability(text);
    const scopeSelect = el("select", { class: "team-select", "aria-label": "Check" },
      el("option", { value: "draft" }, "The whole draft"),
      sceneList.map(x => el("option", { value: x.scene.id }, x.scene.title || "Untitled")));
    scopeSelect.value = sceneList.some(x => x.scene.id === scope) ? scope : "draft";
    scopeSelect.addEventListener("change", () => { scope = scopeSelect.value; render(panel); });

    const bannedInput = el("input", { value: d.banned.join(", "), placeholder: "Words you never want to use, commas between", "aria-label": "Banned words" });
    bannedInput.addEventListener("change", () => { d.banned = bannedInput.value.split(",").map(x => x.trim()).filter(Boolean); W.save(); render(panel); });

    const ease = r.ease >= 70 ? "easy" : r.ease >= 50 ? "fairly hard" : r.ease >= 30 ? "hard" : "very hard";
    const results = rulesFor(d).map(rule => ({ rule, found: rule.find(text, r) })).filter(x => x.found.length);
    return el("section", { class: "media-section" },
      el("div", { class: "media-section-head" }, el("h2", {}, "Style and readability"), scopeSelect),
      text.trim() ? el("div", { class: "wr-stats" },
        stat("Reading ease", `${r.ease}`, `${ease} (Flesch; 60–70 suits most readers)`),
        stat("Grade level", `${r.grade}`, "Flesch-Kincaid; news aims for about 8"),
        stat("Words per sentence", `${r.avg}`, "average"),
        stat("Words", r.words.toLocaleString(), `${r.sentences.length} sentences`)) : el("p", { class: "media-empty" }, "Nothing written yet."),
      el("label", { class: "wr-field" }, `Banned words${d.kind === "article" ? ` · checking against ${d.styleGuide} style (change it in Draft details)` : ""}`, bannedInput),
      results.length ? el("ul", { class: "wr-issues" }, results.map(({ rule, found }) => el("li", {},
        el("details", {},
          el("summary", {}, el("strong", {}, rule.name), ` · ${found.length}`, rule.tip && el("span", { class: "media-muted" }, ` · ${rule.tip}`)),
          el("ul", { class: "wr-issue-list" }, [...new Set(found.map(String))].slice(0, 15).map(m => el("li", {},
            el("button", { type: "button", class: "comment-action", onclick: () => W.findText(m.trim()) }, m.trim().length > 90 ? m.trim().slice(0, 89) + "…" : m.trim()),
            rule.fix && el("span", { class: "media-muted" }, ` → ${rule.fix(m.trim())}`))))))))
        : text.trim() && el("p", { class: "media-muted" }, "No style issues found."));
  }

  const stat = (label, value, note) => el("div", { class: "wr-stat" }, el("span", { class: "wr-stat-value" }, value), el("span", { class: "wr-stat-label" }, label), el("span", { class: "media-muted" }, note));

  W.register("check", { render });
  W.readability = readability;
})();
