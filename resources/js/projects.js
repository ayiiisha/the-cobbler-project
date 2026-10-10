/* =========================================================
   projects.js — the Projects page
   ---------------------------------------------------------
   Two sections:
     • Your Projects — a card per project, with search and sort.
       Each card can make the project active, rename, duplicate,
       export or delete it.
     • Import Projects — pick or drop backup (.json) or shared
       files, preview what's inside, choose which projects to add.
       A project shared by a collaborator can be merged into your
       copy instead (share.js does the merging); you review any
       differences first.

   Needs projects-core.js and project-ui.js loaded first.
   ========================================================= */
(() => {

  /* ---------- Small helpers ---------- */

  const $ = (id) => document.getElementById(id);

  // Tells the sidebar (and this page) that projects changed, so they redraw
  const announceChange = () => document.dispatchEvent(new Event("projects-changed"));

  // "Oct 8, 2026"
  const formatDate = (time) =>
    new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  // "512 B" or "3.4 KB"
  const formatSize = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);

  // [{ key: "resources", count: 9 }] → "resources: 9"
  const describeContents = (summary) =>
    summary.length ? summary.map(s => `${s.key}: ${s.count}`).join(", ") : "nothing yet";

  // Same summary as Projects.info(), worked out from raw data (for the import preview)
  const summarize = (data) =>
    Object.entries(data).map(([key, v]) => ({ key, count: Projects.countItems(v) }));

  // A small button with a click handler
  function makeButton(label, onClick, { disabled = false, ariaLabel, title } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-btn";
    button.textContent = label;
    button.disabled = disabled;
    if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
    if (title) button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  // A paragraph with a class and plain text
  function makeText(className, text) {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
  }


  /* =========================================================
     START-UP: wire up the page once it has loaded
     ========================================================= */
  document.addEventListener("DOMContentLoaded", () => {

    /* ---------- Safety check ---------- */
    if (!window.Projects) {
      console.error("projects.js: window.Projects is missing. Load projects-core.js first.");
      return;
    }


    /* =========================================================
       YOUR PROJECTS (cards)
       ========================================================= */

    const grid          = $("project-grid");
    const searchInput   = $("project-search");
    const sortSelect    = $("project-sort");
    const showArchived  = $("project-show-archived");
    const browserStatus = $("browser-status");

    /* ---------- One project card ---------- */
    function makeCard(p) {
      const card = document.createElement("article");
      card.className = "callout-box project-card" + (p.active ? " accent-2" : "") + (p.archived ? " is-archived" : "");

      // Name (+ "Active" or "Archived" badge)
      const title = document.createElement("h3");
      title.textContent = p.name;
      if (p.active || p.archived) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = p.active ? "Active" : "Archived";
        title.append(" ", badge);
      }
      card.append(title);

      // Description, dates, contents
      if (p.description) card.append(makeText("project-desc", p.description));
      card.append(
        makeText("project-meta", `Created ${formatDate(p.created)} · Edited ${formatDate(p.updated)} · ${formatSize(p.bytes)}`),
        makeText("project-meta", `Contains: ${describeContents(p.summary)}`)
      );

      // Buttons
      const actions = document.createElement("div");
      actions.className = "section-head";
      actions.append(
        makeButton(p.active ? "Active" : "Make active", () => {
          Projects.switchTo(p.id);   // (also takes it out of the archive)
          announceChange();
          browserStatus.textContent = `"${p.name}" is now the active project.`;
        }, { disabled: p.active, ariaLabel: `Make ${p.name} the active project` }),

        makeButton(p.archived ? "Unarchive" : "Archive", () => {
          Projects.setArchived(p.id, !p.archived);
          announceChange();
          browserStatus.textContent = p.archived ? `"${p.name}" is back from the archive.` : `Archived "${p.name}".`;
        }, {
          disabled: p.active,   // the project you're working in can't be archived
          title: p.active ? "Switch to another project to archive this one" : null,
          ariaLabel: `${p.archived ? "Unarchive" : "Archive"} ${p.name}`,
        }),

        makeButton("Rename", () => {
          const name = prompt("New name:", p.name);
          if (name === null) return;
          Projects.renameById(p.id, name);
          announceChange();
        }, { ariaLabel: `Rename ${p.name}` }),

        makeButton("Duplicate", () => {
          Projects.duplicate(p.id);
          announceChange();
          browserStatus.textContent = `Duplicated "${p.name}".`;
        }, { ariaLabel: `Duplicate ${p.name}` }),

        makeButton(p.readOnly ? "Send my comments back" : "Share", () => {
          if (p.readOnly) {
            ProjectShare.download(p.id, { feedback: true }).then(r => {
              browserStatus.textContent = r ? `Downloaded ${r.name}: send it to ${p.sharedBy || "whoever shared this"}. They import it to see your comments.` : "Couldn't make the file.";
            });
            return;
          }
          shareDialog(p);
        }, { ariaLabel: `Share ${p.name}`, title: p.readOnly ? "Your comments on this read-only copy, to send back" : "A full copy for collaborators, or a read-only copy for feedback" }),

        makeButton("Email", async () => {
          browserStatus.textContent = `Preparing "${p.name}"…`;
          const result = await ProjectShare.email(p.id);
          browserStatus.textContent = !result ? "Couldn't share that project."
            : result.how === "cancelled" ? "Not sent."
            : result.how === "share" ? `Shared "${p.name}".`
            : `Downloaded "${p.name}" and opened a new email: attach ${result.name} from your Downloads folder.`;
          renderCards();
        }, { ariaLabel: `Email ${p.name} to collaborators`, title: "Attaches the shared file to an email, with a list of what changed" }),

        makeButton("Changes since last share", () => showChanges(p), { ariaLabel: `Changes to ${p.name} since you last shared it` }),

        makeButton("Export", () => {
          Projects.backupById(p.id);
          browserStatus.textContent = `Exported "${p.name}".`;
        }, { ariaLabel: `Export ${p.name}`, title: "Backup file (.json) to restore or import later" }),

        // Everything in the project as a readable document
        makeButton("Details (.docx)", () => {
          ProjectReport.docx(p.id);
          browserStatus.textContent = `Downloaded the details of "${p.name}" as a Word document.`;
        }, { ariaLabel: `Download the details of ${p.name} as a Word document` }),

        makeButton("Details (PDF)", () => ProjectReport.pdf(p.id), {
          ariaLabel: `Save the details of ${p.name} as a PDF`, title: "Opens the print window: choose “Save as PDF”",
        }),

        makeButton("Delete", () => {
          if (!confirm(`Delete "${p.name}" and everything in it? Export it first if unsure.`)) return;
          if (!Projects.removeById(p.id)) {
            browserStatus.textContent = "You need at least one project.";
            return;
          }
          announceChange();
          browserStatus.textContent = `Deleted "${p.name}".`;
        }, { ariaLabel: `Delete ${p.name}` })
      );
      card.append(actions);

      // Read-only copies, and locked versions
      if (p.readOnly) {
        card.append(makeText("project-meta", `Read-only copy${p.sharedBy ? ` from ${p.sharedBy}` : ""}: only comments are saved.`));
        actions.append(makeButton("Make it my own copy", () => {
          if (!confirm(`Make “${p.name}” an ordinary project you can edit? It stops being linked to ${p.sharedBy || "the original"} (your comments can't be sent back after that).`)) return;
          Projects.makeEditable(p.id);
          announceChange();
        }));
      }
      if (!p.readOnly) actions.append(makeButton("Lock a version", async () => {
        const name = prompt("Name this locked version (it's kept as it is now, and syncing never changes it):", "Picture lock");
        if (name == null) return;
        await ProjectShare.lockVersion(p.id, name.trim() || "Locked version");
        browserStatus.textContent = `Locked “${name}” for "${p.name}".`;
        renderCards();
      }, { ariaLabel: `Lock a version of ${p.name}` }));
      ProjectShare.lockedVersions(p.id).then(locks => {
        if (!locks.length) return;
        actions.append(makeButton(`Locked versions (${locks.length})`, () => showLocks(p, locks)));
      });

      // Sharing details, and undo for the last merge
      if (p.shareId) {
        const note = makeText("project-meta", p.sync ? "Syncs through your sync folder."
          : p.lastShared ? `Last shared ${formatDate(p.lastShared)}.` : "Shared before, from another copy.");
        card.append(note);
      }
      ProjectShare.undoInfo(p.id).then(saved => {
        if (!saved) return;
        const undo = makeButton(`Undo last merge (${new Date(saved.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })})`, async () => {
          if (!confirm(`Put “${p.name}” back as it was ${saved.label || "before the last merge"}? Changes since then are lost.`)) return;
          await ProjectShare.undoMerge(p.id);
          announceChange();
          browserStatus.textContent = `Undid the last merge into "${p.name}".`;
        }, { ariaLabel: `Undo the last merge into ${p.name}` });
        actions.append(undo);
      });

      return card;
    }

    /* ---------- Share: a full copy, or read-only for feedback ---------- */
    function shareDialog(p) {
      const dialog = document.createElement("dialog");
      dialog.className = "project-dialog";
      const heading = document.createElement("h2");
      heading.textContent = `Share “${p.name}”`;
      const choice = (label, note, fn) => {
        const b = makeButton(label, async () => { dialog.close(); await fn(); });
        const wrap = document.createElement("div");
        wrap.className = "share-choice";
        wrap.append(b, makeText("project-meta", note));
        return wrap;
      };
      const done = (r) => {
        browserStatus.textContent = r ? `Downloaded ${r.name} (${formatSize(r.bytes)}${r.files ? `, ${r.files} uploaded file${r.files === 1 ? "" : "s"}` : ""}). Send it on; they import it on their Projects page.` : "Couldn't share that project.";
        renderCards();
      };
      dialog.append(heading,
        choice("Full copy (download)", "Collaborators can edit it and send theirs back to merge.", async () => done(await ProjectShare.download(p.id))),
        choice("Full copy by email", "The same, attached to an email with a list of what changed.", async () => { await ProjectShare.email(p.id); renderCards(); }),
        choice("Read-only copy for feedback", "For editors and beta readers: they can read and comment, then send their comments back to you.", async () => done(await ProjectShare.download(p.id, { readOnly: true }))),
        (() => { const row = document.createElement("div"); row.className = "dialog-actions"; row.append(makeButton("Cancel", () => dialog.close())); return row; })());
      dialog.addEventListener("close", () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    }

    /* ---------- Locked versions ---------- */
    function showLocks(p, locks) {
      const dialog = document.createElement("dialog");
      dialog.className = "project-dialog";
      const heading = document.createElement("h2");
      heading.textContent = `Locked versions of “${p.name}”`;
      const list = document.createElement("ul");
      list.className = "import-list";
      locks.forEach(lock => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        text.textContent = `${lock.name} · ${new Date(lock.at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}${lock.by ? ` · ${lock.by}` : ""}`;
        const row = document.createElement("span");
        row.className = "section-head";
        row.append(
          makeButton("Open as a new project", () => {
            Projects.addImported([{ name: `${p.name} (${lock.name})`, description: `Locked version from ${new Date(lock.at).toLocaleDateString()}`, data: lock.data }]);
            announceChange();
            dialog.close();
            browserStatus.textContent = `Opened “${lock.name}” as a new project.`;
          }),
          makeButton("Download", () => {
            const url = URL.createObjectURL(new Blob([JSON.stringify({ app: "cobbler-project", version: 1, projects: [{ name: `${p.name} (${lock.name})`, description: "", data: lock.data }] }, null, 2)], { type: "application/json" }));
            const a = document.createElement("a");
            a.href = url; a.download = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${lock.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }),
          makeButton("Delete", async () => {
            if (!confirm(`Delete the locked version “${lock.name}”?`)) return;
            await ProjectShare.deleteLock(lock.key);
            li.remove();
            renderCards();
          }));
        li.append(text, row);
        list.append(li);
      });
      const close = document.createElement("div");
      close.className = "dialog-actions";
      close.append(makeButton("Close", () => dialog.close()));
      dialog.append(heading, makeText("project-meta", "Kept in this browser only. Syncing and merging never change them."), list, close);
      dialog.addEventListener("close", () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    }

    /* ---------- What changed since you last shared ---------- */
    function showChanges(p) {
      const text = ProjectShare.changesText(p.id);
      const dialog = document.createElement("dialog");
      dialog.className = "project-dialog";
      const pre = document.createElement("pre");
      pre.className = "changes-text";
      pre.textContent = text;
      const heading = document.createElement("h2");
      heading.textContent = "Changes since last share";
      const row = document.createElement("div");
      row.className = "dialog-actions";
      row.append(
        makeButton("Copy", async () => { try { await navigator.clipboard.writeText(text); } catch { prompt("Copy:", text); } }),
        makeButton("Download (.txt)", () => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
          const a = document.createElement("a");
          a.href = url; a.download = `${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-changes.txt`;
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
        makeButton("Close", () => dialog.close()));
      dialog.append(heading, pre, row);
      dialog.addEventListener("close", () => dialog.remove());
      document.body.append(dialog);
      dialog.showModal();
    }

    /* ---------- Draw all cards (filtered by search, in the chosen order) ---------- */
    function renderCards() {
      const query = searchInput.value.trim().toLowerCase();
      const all = Projects.info();
      const archivedCount = all.filter(p => p.archived).length;
      $("project-archived-label").textContent = `Show archived (${archivedCount})`;

      const projects = all
        .filter(p => showArchived.checked || !p.archived)
        .filter(p => p.name.toLowerCase().includes(query) || p.description.toLowerCase().includes(query));

      const sortBy = {
        name:    (a, b) => a.name.localeCompare(b.name),
        created: (a, b) => b.created - a.created,
        updated: (a, b) => b.updated - a.updated,
      };
      projects.sort(sortBy[sortSelect.value] || sortBy.updated);

      grid.replaceChildren();
      if (!projects.length) {
        grid.append(makeText("", "No projects match."));
        return;
      }
      projects.forEach(p => grid.append(makeCard(p)));
    }

    /* ---------- Toolbar ---------- */
    searchInput.addEventListener("input", renderCards);
    sortSelect.addEventListener("change", renderCards);
    showArchived.addEventListener("change", renderCards);
    document.addEventListener("projects-changed", renderCards);

    $("browser-new").addEventListener("click", () => window.ProjectUI?.openNewProjectDialog());

    $("browser-backup-all").addEventListener("click", () => {
      Projects.backupAll();
      browserStatus.textContent = "Backup of all projects downloaded.";
    });

    renderCards();


    /* =========================================================
       IMPORT PROJECTS
       ========================================================= */

    const fileInput    = $("import-input");
    const dropZone     = $("import-drop");
    const preview      = $("import-preview");
    const importStatus = $("import-status");
    const MAX_BYTES    = 500 * 1024 * 1024;   // ignore files over 500 MB (shared files carry images)

    let waiting = [];   // projects read from files, not imported yet: [{ file, name, description, data }]

    /* ---------- Read the chosen files ---------- */
    async function readFiles(files) {
      const errors = [];
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          errors.push(`${file.name}: file is too large.`);
          continue;
        }
        try {
          const obj = JSON.parse(await file.text());
          Projects.parseBackup(obj)
            .forEach(p => waiting.push({ file: file.name, sharedBy: obj.sharedBy || "", files: obj.files || null, ...p }));
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof SyntaxError ? "not valid JSON." : err.message}`);
        }
      }
      importStatus.textContent = errors.join(" ");
      renderPreview();
    }

    /* ---------- Show what was found: add each as new, or merge into a copy you have ---------- */
    function renderPreview() {
      preview.replaceChildren();
      if (!waiting.length) return;

      const list = document.createElement("ul");
      list.className = "import-list";
      const rows = [];
      const local = Projects.list();

      waiting.forEach(p => {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;

        const text = document.createElement("span");
        text.textContent = ` ${p.name} (${describeContents(summarize(p.data))}) · from ${p.file}${p.sharedBy ? ` · shared by ${p.sharedBy}` : ""}`;

        // Add as new, or merge into one of your projects (your copy of the same project is picked for you)
        const action = document.createElement("select");
        action.className = "import-action";
        action.setAttribute("aria-label", `What to do with ${p.name}`);
        const match = p.shareId ? Projects.findByShareId(p.shareId) : null;
        action.append(new Option("Add as a new project", ""),
          ...local.map(x => new Option(`Merge into “${x.name}”${x.id === match ? " (your copy)" : ""}`, x.id)));
        action.value = match || "";

        const label = document.createElement("label");
        label.append(checkbox, text);
        const item = document.createElement("li");
        item.append(label, action);
        list.append(item);
        rows.push({ p, checkbox, action });
      });

      const actions = document.createElement("div");
      actions.className = "section-head";
      actions.append(
        makeButton("Continue", async () => {
          const chosen = rows.filter(r => r.checkbox.checked);
          if (!chosen.length) {
            importStatus.textContent = "Nothing selected.";
            return;
          }
          const fresh = chosen.filter(r => !r.action.value);
          let files = 0;
          for (const r of chosen) files += await ProjectShare.storeFiles(r.p.files);
          if (fresh.length) {
            Projects.addImported(fresh.map(({ p }) => ({ name: p.name, description: p.description, shareId: p.shareId, readOnly: p.readOnly, sharedBy: p.sharedBy, data: p.data })));
            // Remember what was received, for merging the next version
            for (const { p } of fresh) if (p.shareId) await ProjectShare.saveBase(p.shareId, p.data);
          }
          const merges = chosen.filter(r => r.action.value).map(r => ({ p: r.p, into: r.action.value }));
          waiting = [];
          announceChange();
          importStatus.textContent = [
            fresh.length && `Imported ${fresh.length} project${fresh.length === 1 ? "" : "s"}.`,
            files && `${files} uploaded file${files === 1 ? "" : "s"} added.`,
          ].filter(Boolean).join(" ");
          if (merges.length) reviewMerges(merges); else renderPreview();
        }),
        makeButton("Cancel", () => {
          waiting = [];
          renderPreview();
          importStatus.textContent = "Import cancelled.";
        })
      );

      preview.append(list, actions);
    }

    /* ---------- Merging: review the differences, then merge ---------- */
    async function reviewMerges(queue) {
      const next = queue.shift();
      if (!next) { preview.replaceChildren(); return; }
      const { p, into } = next;
      const target = Projects.list().find(x => x.id === into);
      // The last version you both had, if this copy was shared with or from them before
      const shareId = Projects.shareIdOf(into);
      const mine = Projects.snapshot(into);
      let result, base;
      if (p.kind === "feedback") {
        // Feedback on a read-only copy: only its comments come in (nothing else is touched)
        const merged = ProjectShare.merge({ comments: mine.comments || {} }, { comments: p.data.comments || {} }, undefined);
        result = { ...merged, data: { ...mine, comments: merged.data.comments || {} } };
      } else {
        base = shareId && shareId === p.shareId ? await ProjectShare.loadBase(shareId) : undefined;
        result = ProjectShare.merge(mine, p.data, base);
      }
      const changed = Object.keys(result.data).filter(k => JSON.stringify(result.data[k]) !== JSON.stringify(mine[k]))
        .concat(Object.keys(mine).filter(k => !(k in result.data)))
        .map(k => ProjectShare.KEY_NAMES[k] || k);
      const real = result.conflicts.filter(c => c.mine !== "" && c.mine != null && c.theirs !== "" && c.theirs != null);
      const filled = result.conflicts.length - real.length;

      const box = document.createElement("div");
      box.className = "merge-review";
      const heading = document.createElement("h3");
      heading.textContent = `Merge “${p.name}”${p.sharedBy ? ` from ${p.sharedBy}` : ""} into “${target.name}”`;
      box.append(heading, makeText("merge-summary",
        `${result.added} new thing${result.added === 1 ? "" : "s"} to add` +
        (result.removed ? `, ${result.removed} they deleted to remove` : "") +
        (filled ? `, ${filled} empty field${filled === 1 ? "" : "s"} filled in` : "") +
        `, ${real.length} difference${real.length === 1 ? "" : "s"}` + (real.length ? ": pick which to keep." : ".")),
        makeText("merge-summary", changed.length ? `Brings in changes to: ${[...new Set(changed)].join(", ")}.` : "Nothing new: your copy already has everything in this file."));

      if (real.length) {
        const list = document.createElement("ol");
        list.className = "merge-list";
        real.forEach((c, i) => {
          const item = document.createElement("li");
          const where = document.createElement("p");
          where.className = "merge-where";
          where.textContent = `${c.where}${c.field ? ` › ${c.field}` : ""}`;
          const choice = (value, label, shown) => {
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = `merge-${i}`;
            radio.checked = c.choice === value;
            radio.addEventListener("change", () => c.apply(value));
            const span = document.createElement("span");
            span.textContent = ` ${label}: ${ProjectShare.preview(shown)}`;
            const l = document.createElement("label");
            l.className = "merge-choice";
            l.append(radio, span);
            return l;
          };
          item.append(where, choice("mine", "Keep yours", c.mine), choice("theirs", `Use ${p.sharedBy || "theirs"}`, c.theirs));
          list.append(item);
        });
        box.append(list);
      }
      box.append(makeText("media-muted", p.kind === "feedback"
        ? "Feedback on a read-only copy: only comments come in; nothing else in your project changes."
        : base
        ? "Changes only one of you made are taken without asking. Download a backup first if you want to be able to undo."
        : "First merge with this copy: things deleted on one side come back if the other side still has them, so delete them again after merging. Next time, changes only one of you made are taken without asking. Download a backup first if you want to be able to undo."));

      const actions = document.createElement("div");
      actions.className = "section-head";
      actions.append(
        makeButton("Merge", async () => {
          await ProjectShare.saveUndo(into, `before merging ${p.sharedBy ? `${p.sharedBy}'s` : "the"} file`);
          Projects.replaceData(into, result.data);
          if (p.shareId && !Projects.shareIdOf(into)) Projects.setShareId(into, p.shareId);
          if (p.shareId && p.kind !== "feedback") await ProjectShare.saveBase(p.shareId, p.data);
          announceChange();
          importStatus.textContent = `Merged into “${target.name}”. Reload any other open tabs to see the changes.`;
          reviewMerges(queue);
        }),
        makeButton("Back up mine first", () => Projects.backupById(into)),
        makeButton("Skip", () => {
          importStatus.textContent = `Didn't merge “${p.name}”.`;
          reviewMerges(queue);
        })
      );
      box.append(actions);
      preview.replaceChildren(box);
      box.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /* ---------- Choose files with the button ---------- */
    $("import-choose").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      await readFiles([...fileInput.files]);
      fileInput.value = "";
    });

    /* ---------- Or click / press Enter on the drop zone ---------- */
    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });

    /* ---------- Or drag files onto the drop zone ---------- */
    ["dragenter", "dragover"].forEach(type =>
      dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        dropZone.classList.add("dragging");
      }));
    ["dragleave", "drop"].forEach(type =>
      dropZone.addEventListener(type, () => dropZone.classList.remove("dragging")));
    dropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      readFiles([...event.dataTransfer.files]);
    });
  });
})();
