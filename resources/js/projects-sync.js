/* =========================================================
   projects-sync.js — the Sync folder and Activity sections
   of the Projects page
   ---------------------------------------------------------
   Sync folder: your name, the folder, which projects sync, and
   projects others have put in the folder (to join).
   Activity: who changed what in the active project, newest first.

   Needs projects-core.js, share.js and sync.js.
   ========================================================= */
(() => {

  if (!window.Projects) return;
  const $ = (id) => document.getElementById(id);

  const el = Cobbler.el;

  const when = (t) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const announce = () => document.dispatchEvent(new Event("projects-changed"));


  /* =========================================================
     SYNC FOLDER
     ========================================================= */

  function renderSync() {
    const box = $("sync-panel");
    if (!box || !window.CobblerSync) return;
    const S = CobblerSync.status();

    // Your name (stamps, the activity feed and your file in the folder use it)
    const name = el("input", { value: Projects.me(), maxlength: "60", placeholder: "e.g. Aisha", autocomplete: "name", "aria-label": "Your name" });
    name.addEventListener("change", () => { Projects.setMe(name.value); renderSync(); });

    const days = el("input", { type: "number", min: "0", max: "60", value: String(CobblerSync.reminderDays()), class: "sync-days", "aria-label": "Days before a reminder" });
    days.addEventListener("change", () => CobblerSync.setReminderDays(days.value));

    const common = [
      el("div", { class: "sync-row" },
        el("label", { class: "sync-field" }, "Your name (on your changes)", name),
        el("label", { class: "sync-field" }, "Remind me to share after", el("span", {}, days, " days (0 = never)"))),
    ];

    if (!CobblerSync.supported) {
      box.replaceChildren(...common, el("p", { class: "sync-note" },
        "This browser can't open folders, so folder sync isn't available here. Use Chrome or Edge on a computer for it. Share, Email and Import (below) work in every browser."));
      return;
    }

    const stateText = {
      off: "No sync folder chosen.",
      "needs-permission": `Sync folder “${S.folder}” needs your permission again.`,
      syncing: `Syncing with “${S.folder}”…`,
      ok: `Synced with “${S.folder}” at ${S.last ? when(S.last) : "—"}.`,
      error: `Couldn't sync with “${S.folder}”: ${S.message}`,
    }[S.state] || "";
    const merged = S.report?.merged || [];

    const buttons = el("div", { class: "section-head" },
      S.state === "off"
        ? el("button", { type: "button", class: "small-btn", onclick: choose }, "Choose sync folder")
        : [
          S.state === "needs-permission" && el("button", { type: "button", class: "small-btn", onclick: () => CobblerSync.start({ ask: true }) }, "Reconnect"),
          el("button", { type: "button", class: "small-btn", disabled: S.state !== "ok" && S.state !== "error", onclick: () => CobblerSync.syncNow() }, "Sync now"),
          el("button", { type: "button", class: "small-btn", onclick: choose }, "Change folder"),
          el("button", { type: "button", class: "small-btn", onclick: async () => {
            if (!confirm("Stop syncing? Nothing is deleted: your projects stay here, and the folder keeps its copies.")) return;
            await CobblerSync.forgetFolder();
          } }, "Stop syncing"),
        ]);

    // Which projects sync
    const projects = Projects.info().filter(p => !p.archived);
    const list = el("ul", { class: "sync-projects" }, projects.map(p => {
      const box = el("input", { type: "checkbox", checked: p.sync, disabled: S.state === "off" });
      box.addEventListener("change", async () => {
        Projects.setSync(p.id, box.checked);
        if (box.checked) Projects.shareIdOf(p.id, { create: true });
        announce();
        if (box.checked) await CobblerSync.syncNow();
        renderSync();
      });
      return el("li", {}, el("label", { class: "sync-project" }, box, ` ${p.name}`,
        p.sync && el("span", { class: "media-muted" }, p.lastShared ? ` · synced ${when(p.lastShared)}` : "")));
    }));

    const joinable = S.joinable || [];
    box.replaceChildren(...[
      ...common,
      el("p", { class: `sync-state is-${S.state}`, role: "status" }, stateText),
      merged.length > 0 && el("p", { class: "media-muted" }, `Last sync brought in changes from ${[...new Set(merged.map(m => `${m.person} (${m.project})`))].join(", ")}.`),
      buttons,
      el("h3", {}, "Sync these projects"),
      list,
      S.state !== "off" && el("h3", {}, "Projects in the folder"),
      S.state !== "off" && (joinable.length
        ? el("ul", { class: "sync-projects" }, joinable.map(j => el("li", { class: "sync-join" },
            el("span", {}, `${j.name}`, el("span", { class: "media-muted" }, ` · ${j.person ? `from ${j.person}, ` : ""}saved ${when(j.saved)}`)),
            el("button", { type: "button", class: "small-btn", onclick: async () => {
              const id = await CobblerSync.join(j.shareId);
              if (id) $("browser-status").textContent = `Joined “${j.name}”. It's in your projects and syncs from now on.`;
            } }, "Join"))))
        : el("p", { class: "media-muted" }, "Nothing new: every project in the folder is already here.")),
    ].filter(x => x != null && x !== false));
  }

  async function choose() {
    if (!Projects.me()) {
      const name = prompt("Your name, so collaborators know which changes are yours:");
      if (!name?.trim()) return;
      Projects.setMe(name);
    }
    try {
      const folder = await CobblerSync.chooseFolder();
      $("browser-status").textContent = `Syncing with “${folder}”. Tick the projects to share.`;
    } catch (err) {
      if (err?.name !== "AbortError") $("browser-status").textContent = err.message || String(err);
    }
    renderSync();
  }


  /* =========================================================
     ACTIVITY
     ========================================================= */

  function renderActivity() {
    const list = $("activity-list");
    if (!list) return;
    const all = Projects.activity();
    const people = [...new Set(all.map(a => a.by))];
    const select = $("activity-who");
    const chosen = select.value;
    select.replaceChildren(el("option", { value: "" }, "Everyone"), ...people.map(p => el("option", { value: p }, p)));
    select.value = people.includes(chosen) ? chosen : "";
    const shown = all.filter(a => !select.value || a.by === select.value).slice(0, 150);
    $("activity").querySelector("h2").textContent = `Activity in “${Projects.activeName()}”`;
    list.replaceChildren(...(shown.length ? shown.map(a => el("li", { class: `activity-item is-${a.kind}` },
      el("span", { class: "activity-when" }, when(a.at)),
      el("strong", {}, a.by || "Someone"),
      el("span", {}, ` ${a.kind === "added" ? "added" : a.kind === "deleted" ? "deleted" : "changed"} ${a.label}`)))
      : [el("li", { class: "media-muted" }, "Nothing yet. Changes appear here as you and your collaborators work.")]));
  }


  /* =========================================================
     DIFFERENCES SETTLED AUTOMATICALLY
     ========================================================= */

  function renderConflicts() {
    const box = $("conflict-list");
    if (!box || !window.CobblerSync) return;
    const all = Projects.info().flatMap(p => CobblerSync.conflictsFor(p.id).map(c => ({ ...c, projectId: p.id, project: p.name })))
      .sort((a, b) => b.at - a.at);
    $("differences").hidden = !all.length;
    box.replaceChildren(...all.map(c => {
      const kept = c.chose === "mine" ? c.mine : c.theirs;
      const other = c.chose === "mine" ? c.theirs : c.mine;
      return el("li", { class: "conflict-item" },
        el("p", { class: "merge-where" }, `${c.project} › ${c.where}${c.field ? ` › ${c.field}` : ""}`),
        el("p", {}, `Kept ${c.chose === "mine" ? "yours" : `${c.person}'s`}: `, el("strong", {}, ProjectShare.preview(kept)),
          el("span", { class: "media-muted" }, ` · ${c.chose === "mine" ? `${c.person}'s` : "yours"} was: ${ProjectShare.preview(other)} · ${when(c.at)}`)),
        el("div", { class: "comment-actions" },
          el("button", { type: "button", class: "small-btn", onclick: () => {
            if (!CobblerSync.switchConflict(c.projectId, c.id)) { $("browser-status").textContent = "That's changed since: edit it on its page instead."; return; }
            $("browser-status").textContent = `Switched to ${c.chose === "mine" ? `${c.person}'s` : "your"} version.`;
            renderConflicts(); renderActivity();
          } }, `Use ${c.chose === "mine" ? `${c.person}'s` : "mine"} instead`),
          el("button", { type: "button", class: "comment-action", onclick: () => { CobblerSync.dismissConflict(c.projectId, c.id); renderConflicts(); } }, "That's right")));
    }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderConflicts();
    window.CobblerSync?.onChange(renderConflicts);
    renderSync();
    renderActivity();
    window.CobblerSync?.onChange(() => { renderSync(); renderActivity(); });
    $("activity-who").addEventListener("change", renderActivity);
    document.addEventListener("projects-changed", () => { renderSync(); renderActivity(); });
    document.addEventListener("projects-data-changed", renderActivity);
    document.addEventListener("projects-refresh", () => { renderSync(); renderActivity(); renderConflicts(); });
    if (location.hash === "#sync") $("sync").scrollIntoView();
  });
})();
