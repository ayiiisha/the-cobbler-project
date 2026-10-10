/* =========================================================
   undo.js — Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z on every page
   ---------------------------------------------------------
   Undoes and redoes your recent changes anywhere in the app:
   deleting a card, ticking a box, moving a scene, editing a
   field… (Projects.undo() / redo() in projects-core.js keep
   the steps.) Ctrl+Y also redoes, on Windows.

   While you're typing in a text box, Cmd/Ctrl+Z undoes your
   typing there, as usual. The drawing pages keep their own
   undo for strokes while you draw.

   After an undo the page redraws itself from the data as it now
   is (Projects.refresh: each page listens for "projects-refresh")
   and a note offers Redo/Undo. A page that can't redraw itself
   reloads instead, keeping your place.

   Needs projects-core.js (and sync.js for the note).
   ========================================================= */
(() => {

  if (!window.Projects?.undo) return;

  const NOTE_KEY = "cobblerUndoNote";
  const SCROLL_KEY = "cobblerUndoScroll";

  const typing = (target) => target?.closest?.("input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]):not([type=color]), textarea, [contenteditable=''], [contenteditable=true]");

  const describe = (label, project) => `${label}${project && project !== Projects.activeName() ? ` in “${project}”` : ""}`;

  function go(redo) {
    // Save anything waiting to be saved first (pages save on "pagehide")
    window.dispatchEvent(new Event("pagehide"));
    const done = redo ? Projects.redo() : Projects.undo();
    if (!done) {
      note(redo ? "Nothing to redo." : "Nothing to undo.", []);
      return;
    }

    // Pages that can redraw themselves do, right here
    if (Projects.refresh({ reason: redo ? "redo" : "undo", key: done.key, projectId: done.projectId })) {
      note(`${redo ? "Redone" : "Undone"}: change to ${describe(done.label, done.project)}.`, [
        redo ? ["Undo", () => go(false)] : ["Redo", () => go(true)],
      ]);
      return;
    }

    // Otherwise reload, keeping the place and the note for afterwards
    Projects.freeze();   // stop this page saving its old copy while it reloads
    try {
      sessionStorage.setItem(NOTE_KEY, JSON.stringify({ redo, label: done.label, project: done.project, at: Date.now() }));
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ path: location.pathname + location.search + location.hash, y: window.scrollY }));
    } catch {}
    location.reload();
  }

  function note(message, actions) {
    if (window.CobblerSync?.toast) CobblerSync.toast(message, actions, { id: "undo-toast" });
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;                     // e.g. the drawing editor's own undo
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    const isUndo = key === "z" && !event.shiftKey;
    const isRedo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.metaKey);
    if (!isUndo && !isRedo) return;
    if (typing(event.target) || typing(document.activeElement)) return;   // the text box's own undo
    if (document.querySelector("dialog[open]")) return;     // don't lose a half-filled dialog
    event.preventDefault();
    go(isRedo);
  });

  // After a reload: back to where you were, and say what happened
  document.addEventListener("DOMContentLoaded", () => {
    let saved = null, scroll = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(NOTE_KEY));
      scroll = JSON.parse(sessionStorage.getItem(SCROLL_KEY));
      sessionStorage.removeItem(NOTE_KEY);
      sessionStorage.removeItem(SCROLL_KEY);
    } catch {}
    if (scroll && scroll.path === location.pathname + location.search + location.hash) {
      setTimeout(() => window.scrollTo(0, scroll.y), 120);
    }
    if (saved && Date.now() - saved.at < 10000) {
      setTimeout(() => note(`${saved.redo ? "Redone" : "Undone"}: change to ${describe(saved.label, saved.project)}.`, [
        saved.redo ? ["Undo", () => go(false)] : ["Redo", () => go(true)],
      ]), 150);
    }
  });

  window.CobblerUndo = { undo: () => go(false), redo: () => go(true) };
})();
