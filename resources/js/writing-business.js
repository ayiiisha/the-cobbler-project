/* =========================================================
   writing-business.js — Business and Goals tabs, Writing page
   ---------------------------------------------------------
   BUSINESS: every pitch, query and submission, with responses,
   fees, kill fees, rights granted, invoices and payments.
     project.data.submissions = [{ id, kind, draftId, piece, outlet, contact, sent, status,
       response, fee, killFee, rights, invoiceNo, invoiced, paid, query, notes }]
   "Invoice" makes a simple invoice as a PDF or .docx.

   GOALS: a daily word goal (kept in this browser), today's
   words, your streak and the last 30 days. Words are counted as
   you write on this page (cutting text doesn't take them away).
     project.data.writingLog = [{ id, person, date, words }]

   Needs writing-core.js (doc-export.js for invoices).
   ========================================================= */
(() => {

  const W = window.WritingPage;
  if (!W) return;
  const { el, newId } = W;

  const KINDS = ["Pitch or assignment", "Query to an agent", "Magazine or journal", "Contest", "Publisher", "Grant or fellowship"];
  const STATUSES = ["Drafting", "Sent", "More requested", "Accepted", "Rejected", "No response", "Withdrawn"];
  const RIGHTS = ["", "First North American Serial Rights", "First World Serial Rights", "One-time / reprint rights", "Exclusive for a set time", "All rights", "Other (see notes)"];
  const PAY_DAYS = 30;   // invoices are due this many days after sending

  const money = (n) => (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: currency(), maximumFractionDigits: 2 });
  const currency = () => { try { return localStorage.getItem("writingCurrency") || "USD"; } catch { return "USD"; } };
  const addDays = (iso, n) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
  const daysBetween = (a, b) => { const p = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 86400000); };

  let filter = "";


  /* =========================================================
     BUSINESS
     ========================================================= */

  function renderBusiness(panel) {
    const subs = W.list("submissions");
    const save = () => W.saveList("submissions", subs);
    const today = W.todayISO();
    const drafts = W.drafts();

    const paid = subs.filter(s => s.paid).reduce((n, s) => n + (Number(s.fee) || 0), 0);
    const owed = subs.filter(s => s.invoiced && !s.paid).reduce((n, s) => n + (Number(s.fee) || 0), 0);
    const sent = subs.filter(s => s.sent);
    const answered = sent.filter(s => ["Accepted", "Rejected", "More requested"].includes(s.status) && s.responded);
    const avgDays = answered.length ? Math.round(answered.reduce((n, s) => n + Math.max(0, daysBetween(s.sent, s.responded)), 0) / answered.length) : null;
    const accepted = sent.filter(s => s.status === "Accepted").length;

    const cur = el("select", { class: "team-select", "aria-label": "Currency" }, ["USD", "CAD", "GBP", "EUR", "AUD", "NZD", "INR", "MXN"].map(c => el("option", { value: c }, c)));
    cur.value = currency();
    cur.addEventListener("change", () => { try { localStorage.setItem("writingCurrency", cur.value); } catch {} renderBusiness(panel); });

    const shown = subs.filter(s => !filter || s.status === filter).sort((a, b) => (b.sent || "9999").localeCompare(a.sent || "9999"));
    panel.replaceChildren(
      el("div", { class: "wr-stats" },
        stat("Paid", money(paid)), stat("Owed", money(owed), owed ? "invoiced, not paid" : ""),
        stat("Sent", String(sent.length), `${accepted} accepted`),
        stat("Average reply", avgDays == null ? "–" : `${avgDays} days`, "")),
      el("div", { class: "sketch-nav" },
        el("button", { type: "button", class: "small-btn", onclick: () => {
          subs.push({ id: newId("sub"), kind: KINDS[0], draftId: W.current()?.id || "", piece: W.current()?.title || "", outlet: "", contact: "", sent: "", status: "Drafting",
            responded: "", response: "", fee: "", killFee: "", rights: "", invoiceNo: "", invoiced: "", paid: "", query: "", notes: "" });
          save(); filter = ""; renderBusiness(panel);
        } }, "+ Submission"),
        el("div", { class: "tool-group view-toggle", role: "group", "aria-label": "Show" },
          ["", ...STATUSES].map(st => el("button", { type: "button", "aria-pressed": String(filter === st), onclick: () => { filter = st; renderBusiness(panel); } },
            `${st || "All"} (${subs.filter(s => !st || s.status === st).length})`))),
        el("label", { class: "tool-group" }, "Currency", cur)),
      shown.length ? el("div", { class: "research-grid" }, shown.map(s => card(s, subs, save, drafts, today, panel)))
        : el("p", { class: "media-empty" }, subs.length ? "Nothing with that status." : "Track pitches, queries and submissions: where they went, what came back, what you're owed."));
  }

  const stat = (label, value, note = "") => el("div", { class: "wr-stat" }, el("span", { class: "wr-stat-value" }, value), el("span", { class: "wr-stat-label" }, label), note && el("span", { class: "media-muted" }, note));

  function card(s, subs, save, drafts, today, panel) {
    const redraw = () => renderBusiness(panel);
    const f = (key, label, { type = "text", textarea = false, rows = 2, placeholder = "", change = false } = {}) => {
      const i = textarea ? el("textarea", { rows: String(rows), placeholder, "aria-label": label }) : el("input", { type, placeholder, "aria-label": label });
      i.value = s[key] ?? "";
      i.addEventListener(type === "date" || change ? "change" : "input", () => { s[key] = i.value; save(); if (type === "date" || change) redraw(); });
      return el("label", { class: "wr-field" }, label, i);
    };
    const pick = (key, label, options) => {
      const sel = el("select", { class: "team-select", "aria-label": label }, options.map(o => Array.isArray(o) ? el("option", { value: o[0] }, o[1]) : el("option", { value: o }, o || "—")));
      sel.value = s[key] ?? "";
      sel.addEventListener("change", () => {
        s[key] = sel.value;
        if (key === "status" && ["Accepted", "Rejected", "More requested"].includes(sel.value) && !s.responded) s.responded = W.todayISO();
        if (key === "draftId") s.piece = drafts.find(d => d.id === sel.value)?.title || s.piece;
        save(); redraw();
      });
      return el("label", { class: "wr-field" }, label, sel);
    };
    const due = s.invoiced ? addDays(s.invoiced, PAY_DAYS) : "";
    const payState = s.paid ? `Paid ${W.fmtDate(s.paid)}` : s.invoiced ? (due < today ? `Overdue since ${W.fmtDate(due)}` : `Invoice due ${W.fmtDate(due)}`) : "";
    const waiting = s.status === "Sent" && s.sent ? daysBetween(s.sent, today) : 0;

    return el("article", { class: `research-card wr-sub is-${s.status.toLowerCase().replace(/\s+/g, "-")}` },
      el("div", { class: "research-card-head" },
        el("input", { class: "wr-bible-name", value: s.outlet, placeholder: "Outlet, agent or publisher", "aria-label": "Outlet", oninput: (e) => { s.outlet = e.target.value; save(); } }),
        el("span", { class: "pitch-pill" }, s.status)),
      el("div", { class: "zine-form-row" }, pick("kind", "Kind", KINDS), pick("status", "Status", STATUSES)),
      el("div", { class: "zine-form-row" },
        pick("draftId", "Draft", [["", "Not on this page"], ...drafts.map(d => [d.id, d.title || "Untitled"])]),
        f("piece", "Piece or pitch title")),
      el("div", { class: "zine-form-row" }, f("contact", "Editor or agent"), f("sent", "Sent", { type: "date" }), f("responded", "Replied", { type: "date" })),
      waiting > 0 && el("p", { class: waiting > 30 ? "wr-thread-flag" : "media-muted" }, `Waiting ${waiting} days${waiting > 30 ? ": time to follow up?" : ""}`),
      f("response", "What they said", { textarea: true }),
      s.kind === "Query to an agent" && el("details", { class: "wr-query" }, el("summary", {}, "Query letter"), f("query", "Query letter", { textarea: true, rows: 8 })),
      el("div", { class: "zine-form-row" }, f("fee", `Fee (${currency()})`, { type: "number", change: true }), f("killFee", "Kill fee (% or amount)"), pick("rights", "Rights granted", RIGHTS)),
      el("div", { class: "zine-form-row" }, f("invoiceNo", "Invoice number"), f("invoiced", "Invoiced", { type: "date" }), f("paid", "Paid", { type: "date" })),
      payState && el("p", { class: payState.startsWith("Overdue") ? "wr-thread-flag" : "media-muted" }, payState),
      f("notes", "Notes", { textarea: true }),
      el("div", { class: "comment-actions" },
        (s.fee || s.status === "Accepted") && el("button", { type: "button", class: "comment-action", onclick: () => invoice(s, subs, save, "pdf") }, "Invoice (PDF)"),
        (s.fee || s.status === "Accepted") && el("button", { type: "button", class: "comment-action", onclick: () => invoice(s, subs, save, "docx") }, "Invoice (.docx)"),
        el("button", { type: "button", class: "comment-action", onclick: () => { if (confirm("Delete this submission?")) { subs.splice(subs.indexOf(s), 1); save(); redraw(); } } }, "Delete")));
  }

  function invoice(s, subs, save, format) {
    if (!s.invoiceNo) {
      const numbers = subs.map(x => Number(String(x.invoiceNo).replace(/\D/g, ""))).filter(n => n > 0);
      s.invoiceNo = String((numbers.length ? Math.max(...numbers) : 0) + 1).padStart(3, "0");
    }
    if (!s.invoiced) s.invoiced = W.todayISO();
    save();
    const d = W.drafts().find(x => x.id === s.draftId);
    const from = [d?.byline || Projects.me(), ...(d?.contact || "").split("\n")].filter(x => x && x.trim());
    const blocks = [
      { t: "title", text: `Invoice ${s.invoiceNo}` },
      { t: "fields", items: [["Date", W.fmtDate(s.invoiced)], ["Payment due", W.fmtDate(addDays(s.invoiced, PAY_DAYS))]] },
      { t: "h2", text: "From" }, { t: "p", text: from.join("\n") || "Your name and address" },
      { t: "h2", text: "To" }, { t: "p", text: [s.contact, s.outlet].filter(Boolean).join("\n") || "Outlet" },
      { t: "table", head: ["Description", "Amount"], rows: [[`${s.piece || "Commissioned work"}${s.rights ? ` (${s.rights})` : ""}`, money(s.fee)]] },
      { t: "fields", items: [["Total due", money(s.fee)]] },
      { t: "p", text: "Payment details: (add your bank details or payment link)\nThank you!" },
    ];
    const name = `invoice-${s.invoiceNo}-${W.slug(s.outlet || "outlet")}`;
    if (format === "pdf") DocExport.print(blocks, { title: name });
    else DocExport.downloadDocx(blocks, { title: `Invoice ${s.invoiceNo}`, filename: `${name}.docx` });
    W.show("business");
  }


  /* =========================================================
     GOALS
     ========================================================= */

  const goalKey = "writingGoal";
  const getGoal = () => { try { return Number(localStorage.getItem(goalKey)) || 500; } catch { return 500; } };

  function renderGoals(panel) {
    const me = Projects.me() || "Me";
    const log = W.list("writingLog");
    const mine = new Map(log.filter(e => e.person === me).map(e => [e.date, e.words]));
    const goal = getGoal();
    const today = W.todayISO();
    const iso = (offset) => { const d = new Date(); d.setDate(d.getDate() - offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

    // Streak: days in a row at or over the goal, counting today if done, else from yesterday
    let streak = 0;
    for (let i = (mine.get(today) || 0) >= goal ? 0 : 1; i < 3650; i++) {
      if ((mine.get(iso(i)) || 0) >= goal) streak++; else break;
    }
    const days = Array.from({ length: 30 }, (_, i) => { const date = iso(29 - i); return { date, words: mine.get(date) || 0 }; });
    const max = Math.max(goal, ...days.map(d => d.words), 1);

    const goalInput = el("input", { type: "number", min: "50", step: "50", value: String(goal), "aria-label": "Daily word goal", class: "sync-days" });
    goalInput.addEventListener("change", () => { try { localStorage.setItem(goalKey, String(Math.max(50, Number(goalInput.value) || 500))); } catch {} renderGoals(panel); });

    // A bar chart of the last 30 days, with the goal as a line
    const w = 600, h = 160, bw = w / 30;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h + 20}`);
    svg.setAttribute("class", "wr-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Words written each day for the last 30 days; goal ${goal}`);
    const ns = (tag, attrs, text) => { const n = document.createElementNS("http://www.w3.org/2000/svg", tag); Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v)); if (text) n.textContent = text; return n; };
    days.forEach((d, i) => {
      const bh = Math.round(d.words / max * h);
      const bar = ns("rect", { x: i * bw + 2, y: h - bh, width: bw - 4, height: Math.max(bh, d.words ? 2 : 0), rx: 3, class: d.words >= goal ? "is-met" : "" });
      bar.append(ns("title", {}, `${W.fmtDate(d.date)}: ${d.words.toLocaleString()} words`));
      svg.append(bar);
      if (i % 7 === 1) svg.append(ns("text", { x: i * bw + bw / 2, y: h + 15, "text-anchor": "middle" }, new Date(d.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })));
    });
    const gy = h - Math.round(goal / max * h);
    svg.append(ns("line", { x1: 0, x2: w, y1: gy, y2: gy, class: "wr-goal-line" }));

    const everyone = [...new Set(log.map(e => e.person))].map(p => ({ p, n: log.filter(e => e.person === p && e.date === today).reduce((s, e) => s + e.words, 0) })).filter(x => x.n);

    W.fill(panel,
      el("div", { class: "wr-stats" },
        stat("Today", (mine.get(today) || 0).toLocaleString(), `of ${goal.toLocaleString()} words`),
        stat("Streak", `${streak} day${streak === 1 ? "" : "s"}`, "at or over your goal"),
        stat("Last 30 days", days.reduce((n, d) => n + d.words, 0).toLocaleString(), "words"),
        el("label", { class: "wr-stat" }, goalInput, el("span", { class: "wr-stat-label" }, "Daily goal"), el("span", { class: "media-muted" }, "words"))),
      el("section", { class: "media-section" }, el("h2", {}, "The last 30 days"), svg,
        el("p", { class: "media-muted" }, "Darker bars met the goal; the line is your goal. Counted on this page as you write; cutting text doesn't lower the count.")),
      el("section", { class: "media-section" }, el("h2", {}, "Drafts"),
        el("ul", { class: "wr-progress" }, W.drafts().map(d => {
          const n = W.draftWords(d), t = Number(d.target) || 0;
          return el("li", {}, el("span", {}, el("strong", {}, d.title || "Untitled"), ` · ${n.toLocaleString()} words${t ? ` of ${t.toLocaleString()}` : ""}${d.deadline ? ` · due ${W.fmtDate(d.deadline)}` : ""}`),
            t > 0 && el("progress", { max: String(t), value: String(Math.min(n, t)), "aria-label": `${d.title} progress` }));
        }))),
      everyone.length > 1 && el("section", { class: "media-section" }, el("h2", {}, "Everyone today"),
        el("ul", { class: "wr-progress" }, everyone.map(x => el("li", {}, `${x.p}: ${x.n.toLocaleString()} words`)))));
  }

  W.register("business", { render: renderBusiness });
  W.register("goals", { render: renderGoals });
})();
