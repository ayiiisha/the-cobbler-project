/* =========================================================
   project-ui.js — project controls on every page
   ---------------------------------------------------------
   What this file adds to the page:
     1. A "Projects" button in the sidebar, showing the current project
     2. A pop-up panel beside the sidebar with every project control:
        switch, rename, delete, new project, backup, restore
     3. A round "+" button (bottom right) for a new project
     4. The New Project dialog (used by both the panel and the + button)
     5. A short confirmation message ("toast") after creating a project

   Switching project, creating one or restoring a backup doesn't
   reload the page: the page redraws itself from the new active
   project (Projects.refresh; pages without a listener reload).

   Needs projects-core.js (window.Projects) and header.js loaded first.
   Other scripts can open the New Project dialog with:
     ProjectUI.openNewProjectDialog()
   or make another project active, in place, with:
     ProjectUI.switchTo(id)
   ========================================================= */
(() => {

  /* ---------- Safety check: the Projects API must exist ---------- */
  if (!window.Projects) {
    console.error("project-ui.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }


  /* ---------- Small helpers ---------- */

  const $ = (id) => document.getElementById(id);

  // Tells other parts of the page (e.g. the Projects page) that projects changed
  const announceChange = () => document.dispatchEvent(new Event("projects-changed"));


  /* =========================================================
     HTML TEMPLATES
     ========================================================= */

  /* Sidebar button. `popovertarget` makes the browser open/close the panel. */
  const sidebarButtonTemplate = `
    <button type="button" class="project-button" id="project-button"
            popovertarget="project-panel" aria-haspopup="dialog">
      <span class="project-button-label">Projects</span>
      <span class="project-button-current" id="project-button-current"></span>
    </button>
  `;

  /* Pop-up panel. `popover="auto"` = closes on Esc or a click outside it. */
  const panelTemplate = `
    <div id="project-panel" class="project-panel" popover="auto"
         role="dialog" aria-labelledby="project-panel-title">

      <!-- Title + close button -->
      <div class="panel-head">
        <h2 id="project-panel-title">Projects</h2>
        <button type="button" class="panel-close" aria-label="Close"
                popovertarget="project-panel" popovertargetaction="hide">×</button>
      </div>

      <!-- Current project: switch, rename, delete -->
      <section class="panel-section">
        <label for="panel-project-select">Current project</label>
        <select id="panel-project-select"></select>

        <div class="panel-actions" id="panel-current-actions">
          <button type="button" class="small-btn" id="panel-rename">Rename</button>
          <button type="button" class="small-btn" id="panel-delete">Delete</button>
        </div>

        <form class="panel-rename" id="panel-rename-form" hidden>
          <label for="panel-rename-input" class="visually-hidden">New name</label>
          <input id="panel-rename-input" maxlength="80" required autocomplete="off">
          <div class="panel-actions">
            <button type="submit" class="small-btn">Save</button>
            <button type="button" class="small-btn" id="panel-rename-cancel">Cancel</button>
          </div>
        </form>
      </section>

      <!-- New project -->
      <section class="panel-section">
        <button type="button" class="small-btn panel-wide" id="panel-new">+ New project</button>
      </section>

      <!-- Backup and restore -->
      <section class="panel-section">
        <h3>Backup</h3>
        <div class="panel-actions">
          <button type="button" class="small-btn" id="panel-backup">This project</button>
          <button type="button" class="small-btn" id="panel-backup-all">All projects</button>
          <button type="button" class="small-btn" id="panel-restore">Restore…</button>
        </div>
        <input type="file" id="panel-restore-input" accept=".json,application/json" hidden>
      </section>

      <!-- Link to the full Projects page + status messages -->
      <a class="panel-link" href="projects.html">Manage all projects →</a>
      <p class="panel-status" id="panel-status" role="status"></p>
    </div>
  `;

  /* "+" button, New Project dialog and toast */
  const newProjectTemplate = `
    <button type="button" class="fab" id="new-project-fab"
            aria-label="New project" title="New project">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
        <path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    </button>

    <dialog id="new-project-dialog" class="project-dialog" aria-labelledby="npd-title">
      <form id="new-project-form">
        <h2 id="npd-title">New project</h2>

        <label>Name
          <input name="name" required maxlength="80" autocomplete="off">
        </label>

        <label>Description (optional)
          <textarea name="description" rows="3" maxlength="300"></textarea>
        </label>

        <div class="dialog-actions">
          <button type="submit" class="small-btn">Create project</button>
          <button type="button" class="small-btn" id="npd-cancel">Cancel</button>
        </div>
      </form>
    </dialog>

    <div class="toast" id="project-toast" role="status" aria-live="polite" hidden></div>
  `;


  /* =========================================================
     1. SIDEBAR BUTTON
     ========================================================= */

  function addSidebarButton() {
    const textBox = document.querySelector(".main-header .text-box");
    if (!textBox) return false;   // page has no sidebar
    textBox.insertAdjacentHTML("afterend", sidebarButtonTemplate);
    return true;
  }


  /* =========================================================
     2. PROJECTS PANEL
     ========================================================= */

  /* ---------- Fill in project names (button label + dropdown) ---------- */
  function refreshProjectNames() {
    $("project-button-current").textContent = Projects.activeName();

    const select = $("panel-project-select");
    select.replaceChildren();
    // Archived projects stay out of the menu (open them from the Projects page)
    Projects.list().filter(p => !p.archived).forEach(p => {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      option.selected = p.id === Projects.activeId();
      select.append(option);
    });
  }

  /* ---------- Show a short message at the bottom of the panel ---------- */
  function setPanelStatus(message) {
    $("panel-status").textContent = message;
  }

  /* ---------- Place the panel just right of the sidebar ----------
     Lines the panel's top up with the Projects button and keeps it on
     screen. On narrow screens the CSS ignores these numbers and centers
     the panel instead. */
  function positionPanel() {
    const panel = $("project-panel");
    const button = $("project-button");
    const sidebar = document.querySelector(".main-header");
    const gap = 12;

    const sidebarRight = sidebar.getBoundingClientRect().right;
    const buttonTop = button.getBoundingClientRect().top;
    const lowestTop = window.innerHeight - panel.offsetHeight - gap;
    const top = Math.max(gap, Math.min(buttonTop, lowestTop));

    panel.style.setProperty("--panel-left", `${sidebarRight + gap}px`);
    panel.style.setProperty("--panel-top", `${top}px`);
  }

  /* ---------- Rename: swap the buttons for a small name form ---------- */
  function showRenameForm(show) {
    $("panel-rename-form").hidden = !show;
    $("panel-current-actions").hidden = show;
    if (show) {
      $("panel-rename-input").value = Projects.activeName();
      $("panel-rename-input").select();
    }
  }

  /* ---------- Wire up everything inside the panel ---------- */
  function setUpPanel() {
    document.body.insertAdjacentHTML("beforeend", panelTemplate);
    const panel = $("project-panel");

    // Opening: reset the panel and position it beside the sidebar
    panel.addEventListener("beforetoggle", (event) => {
      if (event.newState !== "open") return;
      showRenameForm(false);
      setPanelStatus("");
      refreshProjectNames();
    });
    panel.addEventListener("toggle", (event) => {
      $("project-button").setAttribute("aria-expanded", String(event.newState === "open"));
      if (event.newState === "open") positionPanel();
    });
    window.addEventListener("resize", () => {
      if (panel.matches(":popover-open")) positionPanel();
    });

    // Switch project: the page redraws itself with the other project's data
    $("panel-project-select").addEventListener("change", (event) => switchTo(event.target.value));

    // Rename
    $("panel-rename").addEventListener("click", () => showRenameForm(true));
    $("panel-rename-cancel").addEventListener("click", () => showRenameForm(false));
    $("panel-rename-form").addEventListener("submit", (event) => {
      event.preventDefault();
      Projects.rename($("panel-rename-input").value);
      showRenameForm(false);
      refreshProjectNames();
      announceChange();
      setPanelStatus("Renamed.");
    });

    // Delete (there must always be at least one project)
    $("panel-delete").addEventListener("click", () => {
      if (Projects.list().length < 2) {
        setPanelStatus("You need at least one project.");
        return;
      }
      if (!confirm(`Delete "${Projects.activeName()}" and everything in it? Back it up first if unsure.`)) return;
      Projects.removeActive();
      location.reload();
    });

    // New project: close the panel and open the New Project dialog
    $("panel-new").addEventListener("click", () => {
      panel.hidePopover();
      openNewProjectDialog();
    });

    // Backup downloads
    $("panel-backup").addEventListener("click", () => {
      Projects.backupActive();
      setPanelStatus("Backup downloaded.");
    });
    $("panel-backup-all").addEventListener("click", () => {
      Projects.backupAll();
      setPanelStatus("Backup of all projects downloaded.");
    });

    // Restore from a backup file (adds it as a new project, then switches to it)
    const restoreInput = $("panel-restore-input");
    $("panel-restore").addEventListener("click", () => restoreInput.click());
    restoreInput.addEventListener("change", async () => {
      const file = restoreInput.files[0];
      if (!file) return;
      try {
        Projects.restore(JSON.parse(await file.text()));
        showActive();
      } catch (err) {
        setPanelStatus(`Couldn't restore: ${err.message}`);
      } finally {
        restoreInput.value = "";
      }
    });

    // Keep names up to date when the Projects page changes something
    document.addEventListener("projects-changed", refreshProjectNames);

    refreshProjectNames();
  }


  /* =========================================================
     3 + 4. "+" BUTTON AND NEW PROJECT DIALOG
     ========================================================= */

  function openNewProjectDialog() {
    const form = $("new-project-form");
    form.reset();
    $("new-project-dialog").showModal();
    form.elements.name.focus();
  }

  function setUpNewProject() {
    document.body.insertAdjacentHTML("beforeend", newProjectTemplate);
    const dialog = $("new-project-dialog");
    const form = $("new-project-form");

    // Open from the + button
    $("new-project-fab").addEventListener("click", openNewProjectDialog);

    // Close with Cancel, or by clicking the dimmed area around the dialog
    $("npd-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    // Create the project, then show it: the page redraws itself with the new
    // (empty) project. (Pages that can't redraw reload; the message is saved
    // first and shown after the reload.)
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      Projects.create(String(data.get("name")), {
        description: String(data.get("description")).trim(),
      });
      dialog.close();
      try {
        sessionStorage.setItem("projectToast", JSON.stringify({ name: Projects.activeName() }));
      } catch {}
      showActive();
    });
  }


  /* =========================================================
     4b. SHOWING ANOTHER PROJECT WITHOUT A RELOAD
     ---------------------------------------------------------
     After a switch (or a new project, or a restore) every page is
     asked to redraw itself from the active project (the same
     "projects-refresh" event undo uses). A page without a listener
     is reloaded instead. "projects-changed" updates the names in
     the panel, the dashboard and the ideas panel.
     ========================================================= */
  function showActive() {
    announceChange();
    const panel = $("project-panel");
    if (panel?.matches(":popover-open")) panel.hidePopover();
    if (!Projects.refresh({ reason: "switch", projectId: Projects.activeId() })) { location.reload(); return; }
    window.scrollTo(0, 0);
    showSavedToast();
  }

  function switchTo(id) {
    if (!id || id === Projects.activeId()) return;
    window.dispatchEvent(new Event("pagehide"));   // pages save anything waiting first
    Projects.switchTo(id);
    showActive();
  }


  /* =========================================================
     5. CONFIRMATION TOAST (after a new project: now, or after a reload)
     ========================================================= */

  function showToast(message) {
    const toast = $("project-toast");
    toast.replaceChildren(message, " ");

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "small-btn";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => { toast.hidden = true; });
    toast.append(dismiss);

    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 8000);
  }

  function showSavedToast() {
    try {
      const saved = sessionStorage.getItem("projectToast");
      if (!saved) return;
      sessionStorage.removeItem("projectToast");
      showToast(`"${JSON.parse(saved).name}" created and active.`);
    } catch {}
  }


  /* =========================================================
     START-UP: build everything once the page has loaded
     ========================================================= */
  document.addEventListener("DOMContentLoaded", () => {
    setUpNewProject();                    // dialog first: the panel uses it
    if (addSidebarButton()) setUpPanel(); // only on pages with a sidebar
    showSavedToast();
  });


  /* ---------- Let other scripts open the New Project dialog, or switch project in place ---------- */
  window.ProjectUI = { openNewProjectDialog, switchTo, showActive };
})();
