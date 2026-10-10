/* =========================================================
   pitches.js — the Pitches page
   ---------------------------------------------------------
   Draft story pitches and track where each one has been sent.
   Saved inside the active project:

     project.data.pitches = [{
       id, title, status, hook, story, whyNow, access,
       format, length, audience, notes,
       links: ["https://…", ...],
       outlets: [{ id, name, editor, email, sentOn: "2026-10-09", status, notes }],
       fromIdea,        (id of the Ideas card it started from, if any)
       created, updated,
     }, ...]

   "Copy email" writes the pitch as an email to one outlet's
   editor. "Download (.md)" saves the whole pitch as Markdown.
   Ideas cards have a "Pitch it" button that opens this page with
   pitches.html#from-idea=<id>, starting a pitch from that idea.

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("pitches.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);

  const STATUSES = ["Idea", "Drafting", "Ready to send", "Pitched", "Commissioned", "Passed"];
  const OUTLET_STATUSES = ["Not sent", "Sent", "Followed up", "Accepted", "Passed"];
  const FORMATS = ["Article", "Feature", "Short documentary", "Feature documentary", "Video explainer", "Podcast episode",
                   "Podcast series", "Radio piece", "Photo essay", "Zine", "Animation", "Data story", "Newsletter"];
  const FIELDS = ["title", "status", "hook", "story", "whyNow", "access", "format", "length", "audience", "notes"];
  // The form calls the length box "runLength": a field named "length" clashes with form.length
  const fieldName = (key) => key === "length" ? "runLength" : key;


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const newId = Cobbler.newId;
  const slug = (text) => Cobbler.slug(text, "pitch");
  const statusClass = (s) => "is-" + s.toLowerCase().replace(/\s+/g, "-");

  const download = (text, filename) => Cobbler.download(text, filename, "text/markdown");

  const setStatus = Cobbler.statusLine("pitch-status-msg", 6000);

  // Your name, as signed in with the person button (used to sign pitch emails)
  const myName = () => Projects.me();


  /* =========================================================
     SAVED DATA
     ========================================================= */

  let pitches = [];
  function loadData() {
    pitches = Projects.getData("pitches", []);
    if (!Array.isArray(pitches)) pitches = [];
    pitches.forEach(p => {
      p.status = STATUSES.includes(p.status) ? p.status : "Drafting";
      p.links = Array.isArray(p.links) ? p.links : [];
      p.outlets = Array.isArray(p.outlets) ? p.outlets : [];
      FIELDS.forEach(k => { p[k] ??= ""; });
    });
  }
  loadData();
  const save = () => Projects.setData("pitches", pitches);

  const view = { status: "", search: "" };


  /* =========================================================
     WRITING THE PITCH (email and Markdown)
     ========================================================= */

  /* The pitch as an email to one outlet: subject line, then paragraphs
     (only the parts that have something in them) */
  function pitchEmail(p, outlet) {
    const first = (outlet?.editor || "").trim().split(/\s+/)[0];
    const facts = [p.format, p.length].filter(Boolean).join(", ");
    const paragraphs = [
      `Hi ${first || "there"},`,
      p.hook,
      p.story,
      p.whyNow && `Why now: ${p.whyNow}`,
      p.access && `Why me: ${p.access}`,
      facts && `Format: ${facts}${p.audience ? `, for ${p.audience}` : ""}.`,
      p.links.length && `More:\n${p.links.join("\n")}`,
      "Thanks for considering it. Happy to talk it through.",
      myName() || "[Your name]",
    ].filter(Boolean).map(t => String(t).trim());
    return `Subject: Pitch: ${p.title}\n\n${paragraphs.join("\n\n")}\n`;
  }

  function pitchMarkdown(p) {
    const section = (heading, text) => text?.trim() ? [`## ${heading}`, "", text.trim(), ""] : [];
    return [
      `# ${p.title}`, "",
      `*${p.status}${p.format ? ` · ${p.format}` : ""}${p.length ? ` · ${p.length}` : ""}*`, "",
      ...(p.hook ? [`> ${p.hook.replace(/\n/g, "\n> ")}`, ""] : []),
      ...section("The story", p.story),
      ...section("Why now", p.whyNow),
      ...section("Why me / access", p.access),
      ...section("Audience", p.audience),
      ...(p.links.length ? ["## Links", "", ...p.links.map(l => `- ${l}`), ""] : []),
      ...(p.outlets.length ? ["## Outlets", "", "| Outlet | Editor | Sent | Status |", "| --- | --- | --- | --- |",
        ...p.outlets.map(o => `| ${o.name || ""} | ${o.editor || ""} | ${o.sentOn || ""} | ${o.status} |`), ""] : []),
      ...section("Notes", p.notes),
    ].join("\n");
  }


  /* =========================================================
     THE LIST OF PITCHES
     ========================================================= */

  function render() {
    const counts = Object.fromEntries(STATUSES.map(s => [s, pitches.filter(p => p.status === s).length]));
    const button = (value, text) => el("button", {
      type: "button", "aria-pressed": String(view.status === value),
      onclick: () => { view.status = value; render(); },
    }, text);
    $("pitch-status").replaceChildren(button("", `All (${pitches.length})`),
      ...STATUSES.filter(s => counts[s]).map(s => button(s, `${s} (${counts[s]})`)));

    const words = view.search.trim().toLowerCase();
    const list = pitches
      .filter(p => !view.status || p.status === view.status)
      .filter(p => !words || [p.title, p.hook, p.story, p.format, ...p.outlets.map(o => `${o.name} ${o.editor}`)]
        .join(" ").toLowerCase().includes(words))
      .sort((a, b) => b.updated - a.updated);

    const grid = $("pitch-grid");
    if (!pitches.length) {
      grid.replaceChildren(el("p", { class: "media-empty" }, "No pitches yet. Start one here, or from a card on the Ideas page."));
      return;
    }
    if (!list.length) {
      grid.replaceChildren(el("p", { class: "media-empty" }, "No pitches match."));
      return;
    }
    grid.replaceChildren(...list.map(card));
  }

  function card(p) {
    const sent = p.outlets.filter(o => o.status !== "Not sent").length;
    const accepted = p.outlets.filter(o => o.status === "Accepted").length;
    const facts = [p.format, p.length].filter(Boolean).join(" · ");
    return el("article", { class: `research-card pitch-card ${statusClass(p.status)}` },
      el("header", { class: "research-card-head" },
        el("h3", {}, p.title || "Untitled pitch"),
        el("span", { class: `pitch-pill ${statusClass(p.status)}` }, p.status)),
      p.hook && el("p", { class: "pitch-hook" }, p.hook),
      facts && el("p", { class: "media-muted" }, facts),
      p.outlets.length > 0 && el("p", { class: "pitch-outlet-summary" },
        `${p.outlets.length} outlet${p.outlets.length === 1 ? "" : "s"} · sent to ${sent}` + (accepted ? ` · ${accepted} accepted` : "")),
      el("footer", { class: "research-card-foot" },
        el("span", { class: "media-muted" }, `Edited ${new Date(p.updated).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`),
        el("span", { class: "comment-actions pitch-card-actions" },
          el("a", { class: "comment-action", href: `packaging.html#from-pitch=${encodeURIComponent(p.id)}`,
                    title: "Start packages (titles, thumbnails, SEO) for the video, article and zine from this pitch" }, "Package it"),
          el("button", { type: "button", class: "comment-action", onclick: () => openPitch(p) }, "Open"))));
  }


  /* =========================================================
     ONE PITCH (dialog). Edits a copy, so Cancel throws it away.
     ========================================================= */

  let editing = null;
  let draft = null;

  function blankPitch(fields = {}) {
    return {
      id: newId("p"), title: "", status: "Drafting", hook: "", story: "", whyNow: "", access: "",
      format: "", length: "", audience: "", notes: "", links: [], outlets: [],
      created: Date.now(), updated: Date.now(), ...fields,
    };
  }

  function openPitch(pitch = null, startFrom = null) {
    editing = pitch;
    draft = pitch ? JSON.parse(JSON.stringify(pitch)) : blankPitch(startFrom || {});
    const form = $("pitch-form");
    form.reset();
    FIELDS.forEach(k => { form.elements[fieldName(k)].value = draft[k] || ""; });
    $("pitch-dialog-title").textContent = pitch ? "Pitch" : "New pitch";
    $("pitch-delete").hidden = !pitch;
    drawLinks(draft.links.length ? draft.links : [""]);
    drawOutlets();
    $("pitch-dialog").showModal();
    form.elements.title.focus();
  }

  /* Reads the form into the draft (links and outlets are kept up to date as you type) */
  function readForm() {
    const data = new FormData($("pitch-form"));
    FIELDS.forEach(k => { draft[k] = String(data.get(fieldName(k)) || "").trim(); });
    draft.links = [...$("pitch-links").querySelectorAll("input")].map(i => i.value.trim()).filter(Boolean);
  }

  function drawLinks(list, focusIndex) {
    const box = $("pitch-links");
    box.replaceChildren(...list.map((text, i) => {
      const input = el("input", { value: text, maxlength: "500", autocomplete: "off", "aria-label": `Link ${i + 1}`, placeholder: "https://… (reporting, documents, samples of your work)" });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const all = [...box.querySelectorAll("input")].map(x => x.value);
        all.splice(i + 1, 0, "");
        drawLinks(all, i + 1);
      });
      return el("li", {}, input, el("button", { type: "button", class: "goal-item-remove research-source-remove", "aria-label": `Remove link ${i + 1}`,
        onclick: () => { const all = [...box.querySelectorAll("input")].map(x => x.value); all.splice(i, 1); drawLinks(all.length ? all : [""]); } }, "×"));
    }));
    if (focusIndex != null) box.children[focusIndex]?.querySelector("input").focus();
  }

  function drawOutlets(focusLast = false) {
    const box = $("pitch-outlets");
    if (!draft.outlets.length) {
      box.replaceChildren(el("p", { class: "media-muted" }, "Add the outlets and editors you're pitching."));
      return;
    }
    box.replaceChildren(...draft.outlets.map((o, i) => {
      const field = (key, label, attrs = {}) => {
        const input = el("input", { value: o[key] || "", "aria-label": label, placeholder: label, autocomplete: "off", ...attrs });
        input.addEventListener("input", () => { o[key] = input.value; });
        return input;
      };
      const status = el("select", { "aria-label": "Status with this outlet" }, OUTLET_STATUSES.map(s => el("option", { value: s }, s)));
      status.value = o.status;
      status.addEventListener("change", () => {
        o.status = status.value;
        // Marking it sent fills in today's date, if there isn't one
        if (o.status !== "Not sent" && !o.sentOn) {
          const d = new Date();
          o.sentOn = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          drawOutlets();
        }
      });
      return el("div", { class: "pitch-outlet" },
        field("name", "Outlet", { maxlength: "120" }),
        field("editor", "Editor", { maxlength: "120" }),
        field("email", "Email", { type: "email", maxlength: "200" }),
        el("label", { class: "pitch-outlet-date" }, "Sent", field("sentOn", "Date sent", { type: "date" })),
        status,
        field("notes", "Notes (rate, deadline, reply…)", { maxlength: "300", class: "pitch-outlet-notes" }),
        el("div", { class: "comment-actions" },
          el("button", { type: "button", class: "comment-action", onclick: () => copyEmail(o) }, "Copy email"),
          o.email && el("button", { type: "button", class: "comment-action", onclick: () => openMail(o) }, "Open in mail app"),
          el("button", { type: "button", class: "comment-action", onclick: () => { draft.outlets.splice(i, 1); drawOutlets(); } }, "Remove")));
    }));
    if (focusLast) box.lastElementChild?.querySelector("input")?.focus();
  }

  async function copyEmail(outlet) {
    readForm();
    const text = pitchEmail(draft, outlet);
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`Pitch email for ${outlet.name || "this outlet"} copied. Paste it into your email.`);
    } catch {
      prompt("Copy the pitch email:", text);
    }
  }

  // Opens the computer's email app with the pitch filled in
  function openMail(outlet) {
    readForm();
    const [subjectLine, ...body] = pitchEmail(draft, outlet).split("\n");
    const subject = subjectLine.replace(/^Subject:\s*/, "");
    location.href = `mailto:${encodeURIComponent(outlet.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.join("\n").trim())}`;
  }

  function setUpDialog() {
    const dialog = $("pitch-dialog");
    const form = $("pitch-form");
    $("pitch-status-select").append(...STATUSES.map(s => el("option", { value: s }, s)));
    $("pitch-formats").append(...FORMATS.map(f => el("option", { value: f })));

    $("pitch-link-add").addEventListener("click", () => {
      const all = [...$("pitch-links").querySelectorAll("input")].map(x => x.value);
      drawLinks([...all, ""], all.length);
    });
    $("pitch-outlet-add").addEventListener("click", () => {
      draft.outlets.push({ id: newId("o"), name: "", editor: "", email: "", sentOn: "", status: "Not sent", notes: "" });
      drawOutlets(true);
    });
    $("pitch-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    $("pitch-download").addEventListener("click", () => {
      readForm();
      download(pitchMarkdown(draft), `${slug(draft.title || "pitch")}.md`);
    });
    $("pitch-delete").addEventListener("click", () => {
      if (!editing || !confirm(`Delete the pitch “${editing.title}”?`)) return;
      pitches = pitches.filter(p => p !== editing);
      save();
      dialog.close();
      render();
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      readForm();
      draft.outlets = draft.outlets.filter(o => (o.name || o.editor || o.email).trim());
      // Sending it somewhere moves an early pitch to "Pitched"
      if (draft.outlets.some(o => o.status !== "Not sent") && STATUSES.indexOf(draft.status) < STATUSES.indexOf("Pitched")) draft.status = "Pitched";
      if (draft.outlets.some(o => o.status === "Accepted")) draft.status = "Commissioned";
      draft.updated = Date.now();
      if (editing) Object.assign(editing, draft);
      else pitches.push(draft);
      save();
      dialog.close();
      render();
    });
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    $("pitch-new").addEventListener("click", () => openPitch());
    $("pitch-search").addEventListener("input", (event) => { view.search = event.target.value; render(); });
    render();

    // Arriving from an Ideas card: start a pitch from that idea (once)
    const fromIdea = new URLSearchParams(location.hash.slice(1)).get("from-idea");
    if (fromIdea) {
      history.replaceState(null, "", location.pathname);
      const existing = pitches.find(p => p.fromIdea === fromIdea);
      const idea = (Projects.getData("ideas", []) || []).find(i => i.id === fromIdea);
      if (existing) openPitch(existing);
      else if (idea) {
        const [first, ...rest] = idea.text.trim().split("\n");
        openPitch(null, { title: first.slice(0, 160), hook: rest.join("\n").trim(), status: "Idea", fromIdea });
      }
    }
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => { loadData(); render(); event.detail.handled = true; });
})();
