/* =========================================================
   team.js — the Team page
   ---------------------------------------------------------
   Every project has its own team, saved inside that project
   under the key "team":

     project.data.team = [{
       id, name, pronouns, roles: ["Producer", ...],
       email, phone, preferred, other, location, notes, added
     }, ...]

   Pick a project at the top to see or edit its team (this
   doesn't change your active project). team.html?project=<id>
   opens a particular project's team (used by the Project Tracker). Roles come from a
   starter list plus any you type in yourself.

   Contacts can be copied (emails), downloaded as contact
   cards (.vcf, opens in Contacts/Outlook/Google) or as a CSV.

   Needs projects-core.js loaded first.
   ========================================================= */
(() => {

  /* ---------- Safety check ---------- */
  if (!window.Projects) {
    console.error("team.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);


  /* =========================================================
     SETTINGS
     ========================================================= */

  const DATA_KEY = "team";

  // Starter roles; anything typed in is added to a project's list
  const STARTER_ROLES = [
    "Producer", "Director", "Reporter", "Writer", "Editor", "Researcher", "Fact-checker",
    "Host", "Camera", "Sound", "Video Editor", "Photographer", "Animator", "Illustrator",
    "Designer", "Composer", "Subject / Source",
  ];


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const newId = () => Cobbler.newId("m");
  const people = (n) => n === 1 ? "1 person" : `${n} people`;
  const slug = (text) => Cobbler.slug(text, "team");

  /* Only allows http, https and mailto links. Adds https:// to things like "example.com". */
  function safeUrl(value) {
    if (!value || /\s/.test(value.trim())) return null;
    let v = value.trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) {
      if (!/^[^@]+\.[a-z]{2,}(\/|$)/i.test(v)) return null;   // looks like a web address?
      v = "https://" + v;
    }
    try {
      const url = new URL(v);
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  // Phone number for a tel: link (digits and a leading +)
  const telHref = (phone) => {
    const digits = phone.replace(/[^\d+]/g, "");
    return digits.replace(/\D/g, "").length >= 3 ? `tel:${digits}` : null;
  };

  // A browser download of some text
  const download = Cobbler.download;

  const setStatus = Cobbler.statusLine("team-status", 6000);


  /* =========================================================
     DATA
     ========================================================= */

  // Whose team is on screen: team.html?project=<id> (from the Project Tracker), or the active project
  const asked = new URLSearchParams(location.search).get("project");
  let projectId = Projects.list().some(p => p.id === asked) ? asked : Projects.activeId();
  let team = [];

  function loadTeam() {
    const saved = Projects.getDataFor(projectId, DATA_KEY, []);
    team = (Array.isArray(saved) ? saved : []).map(m => ({
      id: m.id || newId(), name: m.name || "", pronouns: m.pronouns || "",
      roles: Array.isArray(m.roles) ? m.roles.filter(r => typeof r === "string") : [],
      email: m.email || "", phone: m.phone || "", preferred: m.preferred || "",
      other: m.other || "", location: m.location || "", notes: m.notes || "",
      added: m.added || Date.now(),
    }));
  }

  const saveTeam = () => {
    Projects.setDataFor(projectId, DATA_KEY, team);
    document.dispatchEvent(new Event("team-changed"));   // tells the Tasks and Credits parts (team-tasks.js)
  };

  // For team-tasks.js: whose team is on screen, and the people in it
  window.TeamPage = { projectId: () => projectId, team: () => team, projectName: () => projectName(), roleOrder: () => roleOptions() };

  const projectName = () => Projects.list().find(p => p.id === projectId)?.name || "this project";

  // Roles for the picker: starters plus any this team already uses
  function roleOptions() {
    const used = team.flatMap(m => m.roles);
    return [...new Set([...STARTER_ROLES, ...used])];
  }


  /* =========================================================
     VIEW: filters and sorting
     ========================================================= */

  const view = { role: "", search: "", sort: "added" };

  function visibleMembers() {
    const words = view.search.trim().toLowerCase();
    const list = team
      .filter(m => !view.role || m.roles.includes(view.role))
      .filter(m => !words || [m.name, m.pronouns, ...m.roles, m.email, m.phone, m.other, m.location, m.notes]
        .join(" ").toLowerCase().includes(words));

    if (view.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (view.sort === "role") {
      const order = roleOptions();
      const first = (m) => m.roles.length ? Math.min(...m.roles.map(r => order.indexOf(r))) : Infinity;
      list.sort((a, b) => first(a) - first(b) || a.name.localeCompare(b.name));
    }
    return list;
  }


  /* =========================================================
     DRAWING THE PAGE
     ========================================================= */

  /* "Team for" menu: every project that isn't archived (plus the one shown) */
  function renderProjectMenu() {
    const select = $("team-project");
    const projects = Projects.list().filter(p => !p.archived || p.id === projectId);
    select.replaceChildren(...projects.map(p =>
      el("option", { value: p.id }, p.name + (p.id === Projects.activeId() ? " (active)" : "") + (p.archived ? " (archived)" : ""))));
    select.value = projectId;
  }

  /* Role buttons with counts; click one to show only those people */
  function renderRoleFilter() {
    const counts = {};
    team.forEach(m => m.roles.forEach(r => { counts[r] = (counts[r] || 0) + 1; }));
    const roles = roleOptions().filter(r => counts[r]);
    if (view.role && !counts[view.role]) view.role = "";

    const button = (value, text) => el("button", {
      type: "button", "aria-pressed": String(view.role === value),
      onclick: () => { view.role = value; render(); },
    }, text);

    $("team-roles").replaceChildren(...(roles.length
      ? [button("", `Everyone (${team.length})`), ...roles.map(r => button(r, `${r} (${counts[r]})`))]
      : []));
  }

  function render() {
    renderProjectMenu();
    renderRoleFilter();

    $("team-summary").textContent = team.length
      ? `${people(team.length)} on “${projectName()}”`
      : `Nobody on “${projectName()}” yet.`;
    ["team-copy", "team-vcf", "team-csv"].forEach(id => { $(id).disabled = !team.length; });

    const grid = $("team-grid");
    const members = visibleMembers();
    if (!team.length) {
      grid.replaceChildren(el("p", { class: "team-empty" }, "Add the people working on this project: their roles and how to reach them."));
      return;
    }
    if (!members.length) {
      grid.replaceChildren(el("p", { class: "team-empty" }, "Nobody matches. Clear the search or pick Everyone."));
      return;
    }
    grid.replaceChildren(...members.map(card));
  }

  /* One person's contact card */
  function card(m) {
    const lines = [];
    if (m.email) lines.push(el("li", {}, el("span", { class: "team-label" }, "Email"), el("a", { href: `mailto:${m.email}` }, m.email)));
    if (m.phone) {
      const href = telHref(m.phone);
      lines.push(el("li", {}, el("span", { class: "team-label" }, "Phone"), href ? el("a", { href }, m.phone) : m.phone));
    }
    if (m.other) {
      const href = safeUrl(m.other);
      lines.push(el("li", {}, el("span", { class: "team-label" }, "Other"),
        href ? el("a", { href, target: "_blank", rel: "noopener noreferrer" }, m.other) : m.other));
    }
    if (m.location) lines.push(el("li", {}, el("span", { class: "team-label" }, "Where"), m.location));
    if (m.preferred) lines.push(el("li", {}, el("span", { class: "team-label" }, "Prefers"), m.preferred));

    return el("article", { class: "team-card" },
      el("header", { class: "team-card-head" },
        el("div", { class: "team-avatar", "aria-hidden": "true" }, initials(m.name)),
        el("div", {},
          el("h3", {}, m.name || "Unnamed"),
          m.pronouns && el("p", { class: "team-pronouns" }, m.pronouns))),
      m.roles.length
        ? el("ul", { class: "team-chips team-chips--static", "aria-label": "Roles" }, m.roles.map(r => el("li", { class: "team-chip" }, r)))
        : el("p", { class: "team-no-role" }, "No role yet"),
      lines.length > 0 && el("ul", { class: "team-contact" }, lines),
      m.notes && el("p", { class: "team-notes" }, m.notes),
      el("div", { class: "team-card-actions" },
        el("button", { type: "button", class: "comment-action", onclick: () => openDialog(m) }, "Edit"),
        el("button", { type: "button", class: "comment-action", onclick: () => {
          download(vcard([m]), `${slug(m.name)}.vcf`, "text/vcard");
        } }, "Contact card"),
        el("button", { type: "button", class: "comment-action", onclick: () => removeMember(m) }, "Remove")));
  }

  // "Aisha Haleem" → "AH"
  const initials = (name) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";

  function removeMember(m) {
    if (!confirm(`Remove ${m.name || "this person"} from the team for “${projectName()}”?`)) return;
    team = team.filter(other => other !== m);
    saveTeam();
    render();
    setStatus(`Removed ${m.name || "1 person"}.`);
  }


  /* =========================================================
     ADD / EDIT DIALOG
     ========================================================= */

  let editing = null;            // the person being edited (null = adding)
  let chosenRoles = new Set();   // roles ticked in the dialog

  function renderRoleChips(extraRoles = []) {
    const roles = [...new Set([...roleOptions(), ...extraRoles, ...chosenRoles])];
    $("team-role-options").replaceChildren(...roles.map(role =>
      el("button", {
        type: "button", class: "team-chip team-chip--toggle",
        "aria-pressed": String(chosenRoles.has(role)),
        onclick: (event) => {
          chosenRoles.has(role) ? chosenRoles.delete(role) : chosenRoles.add(role);
          event.currentTarget.setAttribute("aria-pressed", String(chosenRoles.has(role)));
        },
      }, role)));
  }

  function addTypedRole() {
    const input = $("team-new-role");
    const role = input.value.trim().replace(/\s+/g, " ");
    if (!role) return;
    // Match an existing role regardless of capitals
    const existing = [...roleOptions(), ...chosenRoles].find(r => r.toLowerCase() === role.toLowerCase());
    chosenRoles.add(existing || role);
    input.value = "";
    renderRoleChips([existing || role]);
    input.focus();
  }

  function openDialog(member = null) {
    editing = member;
    const form = $("team-form");
    form.reset();
    chosenRoles = new Set(member?.roles || []);
    for (const key of ["name", "pronouns", "email", "phone", "preferred", "other", "location", "notes"]) {
      form.elements[key].value = member?.[key] || "";
    }
    $("team-dialog-title").textContent = member ? `Edit ${member.name || "person"}` : `Add person to “${projectName()}”`;
    $("team-submit").textContent = member ? "Save changes" : "Add person";
    renderRoleChips();
    $("team-dialog").showModal();
    form.elements.name.focus();
  }

  function setUpDialog() {
    const dialog = $("team-dialog");
    const form = $("team-form");

    $("team-new-role-add").addEventListener("click", addTypedRole);
    $("team-new-role").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); addTypedRole(); }
    });

    $("team-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if ($("team-new-role").value.trim()) addTypedRole();   // a role typed but not added yet

      const data = new FormData(form);
      const fields = { roles: [...chosenRoles] };
      for (const key of ["name", "pronouns", "email", "phone", "preferred", "other", "location", "notes"]) {
        fields[key] = String(data.get(key) || "").trim();
      }

      if (editing) {
        Object.assign(editing, fields);
        setStatus(`Saved ${fields.name}.`);
      } else {
        team.push({ id: newId(), added: Date.now(), ...fields });
        setStatus(`Added ${fields.name}.`);
      }
      saveTeam();
      dialog.close();
      render();
    });
  }


  /* =========================================================
     SHARING CONTACTS
     ========================================================= */

  /* Contact cards (vCard 3.0) that Contacts, Outlook and Google can import */
  function vcard(members) {
    const esc = (text) => String(text).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
    return members.map(m => {
      const parts = m.name.trim().split(/\s+/);
      const last = parts.length > 1 ? parts.pop() : "";
      const lines = [
        "BEGIN:VCARD", "VERSION:3.0",
        `FN:${esc(m.name || "Unnamed")}`,
        `N:${esc(last)};${esc(parts.join(" "))};;;`,
        `ORG:${esc(projectName())}`,
      ];
      if (m.roles.length) lines.push(`TITLE:${esc(m.roles.join(", "))}`);
      if (m.email) lines.push(`EMAIL;TYPE=INTERNET:${esc(m.email)}`);
      if (m.phone) lines.push(`TEL:${esc(m.phone)}`);
      const url = safeUrl(m.other);
      if (url) lines.push(`URL:${esc(url)}`);
      const note = [
        m.pronouns && `Pronouns: ${m.pronouns}`,
        m.preferred && `Prefers: ${m.preferred}`,
        m.location && `Location: ${m.location}`,
        m.other && !url && `Other contact: ${m.other}`,
        m.notes,
      ].filter(Boolean).join("\n");
      if (note) lines.push(`NOTE:${esc(note)}`);
      lines.push("END:VCARD");
      return lines.join("\r\n");
    }).join("\r\n") + "\r\n";
  }

  const csvField = Cobbler.csvField;

  function exportCSV() {
    const columns = [["Name", "name"], ["Pronouns", "pronouns"], ["Roles", "roles"], ["Email", "email"], ["Phone", "phone"],
                     ["Preferred contact", "preferred"], ["Other contact", "other"], ["Location / time zone", "location"], ["Notes", "notes"]];
    const lines = [columns.map(c => c[0]).join(",")];
    visibleMembers().forEach(m => lines.push(columns.map(([, key]) =>
      csvField(key === "roles" ? m.roles.join(", ") : m[key])).join(",")));
    download("\uFEFF" + lines.join("\r\n") + "\r\n", `${slug(projectName())}-team.csv`, "text/csv;charset=utf-8");
  }

  /* "Name <email>, ..." ready to paste into an email's To: line */
  async function copyEmails() {
    const withEmail = visibleMembers().filter(m => m.email);
    if (!withEmail.length) { setStatus("Nobody shown has an email address."); return; }
    const text = withEmail.map(m => m.name ? `${m.name.replace(/[<>,"]/g, "")} <${m.email}>` : m.email).join(", ");
    try {
      await navigator.clipboard.writeText(text);
      const n = withEmail.length;
      setStatus(`Copied ${n} email address${n === 1 ? "" : "es"}. Paste them into an email's To: line.`);
    } catch {
      prompt("Copy these addresses:", text);
    }
  }


  /* =========================================================
     START-UP
     ========================================================= */

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    loadTeam();

    $("team-project").addEventListener("change", (event) => {
      projectId = event.target.value;
      view.role = "";
      loadTeam();
      render();
      document.dispatchEvent(new Event("team-changed"));
    });
    $("team-add").addEventListener("click", () => openDialog());
    $("team-copy").addEventListener("click", copyEmails);
    $("team-vcf").addEventListener("click", () =>
      download(vcard(visibleMembers()), `${slug(projectName())}-team.vcf`, "text/vcard"));
    $("team-csv").addEventListener("click", exportCSV);
    if (window.DocExport) $("team-csv").after(DocExport.buttons({ blocks: exportBlocks, title: `Team: ${projectName()}`, filename: `${Cobbler.slug(projectName())}-team`, label: 'Document' }));

    $("team-search").addEventListener("input", (event) => { view.search = event.target.value; render(); });
    $("team-sort").addEventListener("change", (event) => { view.sort = event.target.value; render(); });

    // Project renamed or archived elsewhere on the page (e.g. the Projects panel)
    document.addEventListener("projects-changed", render);

    render();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  /* The team (and its tasks) as a document */
  function exportBlocks() {
    const people = team;
    const tasks = (Projects.getData("tasks", []) || []).filter(t => t && t.text);
    return [
      { t: "title", text: `Team: ${TeamPage?.projectName?.() || Projects.activeName()}` },
      { t: "meta", text: `${people.length} people · ${new Date().toLocaleDateString()}` },
      { t: "table", head: ["Name", "Roles", "Pronouns", "Email", "Phone", "Location", "Notes"], rows: people.map(p => [p.name || "", (p.roles || []).join(", "), p.pronouns || "", p.email || "", p.phone || "", p.location || "", p.notes || ""]) },
      ...(tasks.length ? [{ t: "h2", text: "Tasks" }, { t: "table", head: ["Task", "Who", "Due", "Done"], rows: tasks.map(t => [t.text, t.assignee || "", t.due || "", t.done ? "✓" : ""]) }] : []),
    ];
  }

  document.addEventListener("projects-refresh", (event) => {
    loadTeam();
    render();
    document.dispatchEvent(new Event("team-changed"));   // the Tasks and Credits parts redraw too
    event.detail.handled = true;
  });
})();
