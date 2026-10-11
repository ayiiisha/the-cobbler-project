/* =========================================================
   boot.js — loads a page's scripts once the projects are ready
   ---------------------------------------------------------
   Projects live in IndexedDB, which takes a moment to read, so
   the scripts that use them can't simply be <script> tags that
   run as the page loads. Each page lists them on this tag instead:

     <script src="../resources/js/boot.js"
             data-scripts="project-ui.js comments.js … my-page.js"></script>

   Once Projects.ready has resolved and the page has been parsed,
   the scripts are fetched together and run in that order, then the page's
   "DOMContentLoaded" hooks run (the scripts use that event to draw
   the page, as they did when they were ordinary deferred scripts).
   Scripts that don't need the projects (util.js, projects-core.js,
   header.js, color-themes.js, vendor files) stay as normal tags.

   Finally "cobbler-ready" is sent on document, for anything that
   wants to know the page is fully up.
   ========================================================= */
(() => {
  const tag = document.currentScript;
  const files = (tag?.dataset.scripts || "").split(/\s+/).filter(Boolean);
  const base = new URL("./", tag?.src || location.href);

  const parsed = new Promise(resolve => {
    if (document.readyState !== "loading") resolve();
    else document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });

  // All the scripts are requested at once (so they download in parallel) and run in
  // order: a dynamically added script with async = false behaves like a normal tag
  const loadAll = () => Promise.all(files.map(file => new Promise(resolve => {
    const script = document.createElement("script");
    script.src = new URL(file, base).href;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => { console.error(`boot.js: couldn't load ${file}`); resolve(); };
    document.head.append(script);
  })));

  // window.cobblerReady resolves once everything is up (the test runner waits for it)
  window.cobblerReady = Promise.all([window.Projects?.ready, parsed]).then(async () => {
    await loadAll();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    document.dispatchEvent(new Event("cobbler-ready"));
  });
})();
