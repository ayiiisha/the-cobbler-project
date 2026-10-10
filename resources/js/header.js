/* =========================================================
   header.js — sidebar navigation on every page
   ---------------------------------------------------------
   What this file adds to the page:
     1. The hamburger button (top left)
     2. The sidebar with the logo and page links
     3. The dimmed backdrop behind the sidebar on small screens
     4. The "Return to top" button at the bottom of the page

   The open/closed state lives as a class on <html>:
     <html class="nav-open">   sidebar showing
     <html class="nav-ready">  animations allowed (added after first paint)
   ========================================================= */
(() => {

  /* =========================================================
     HTML TEMPLATES
     ========================================================= */

  /* Hamburger button + backdrop + sidebar */
  const headerTemplate = `
    <button class="nav-toggle" type="button" aria-label="Toggle navigation menu"
            aria-controls="site-nav" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>

    <div class="nav-backdrop"></div>

    <header class="main-header" id="site-nav">
      <div class="nav-logo">
        <a href="index.html">
          <img src="../resources/assets/cobbler-logo.svg" alt="The Cobbler Project" class="logo-img">
        </a>
      </div>

      <div class="text-box">
        <h3>The Cobbler Project</h3>
      </div>

      <!-- project-ui.js inserts the "Projects" button here -->

      <nav class="nav-links">
        <ul>
        <li><a href="av-script.html">A/V Script</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="calendar.html">Calendar</a></li>
        <li><a href="data-analysis.html">Data Analysis</a></li>
        <li><a href="index.html">Home</a></li>
        <li><a href="ideas.html">Ideas</a></li>
        <li><a href="interviews.html">Interviews</a></li>
        <li><a href="media-and-transcripts.html">Media & Transcripts</a></li>
        <li><a href="music.html">Music</a></li>
        <li><a href="packaging.html">Packaging</a></li>
        <li><a href="pitches.html">Pitches</a></li>
        <li><a href="project-tracker.html">Project Tracker</a></li>
        <li><a href="projects.html">Projects</a></li>
        <li><a href="research.html">Research</a></li>
        <li><a href="resources.html">Resources</a></li>
        <li><a href="screenplay.html">Screenplay</a></li>
        <li><a href="storyboarder.html">Storyboarder</a></li>
        <li><a href="team.html">Team</a></li>
        <li><a href="writing.html">Writing</a></li>
        <li><a href="zine-planner.html">Zine Planner</a></li>
        <li><a href="settings.html">Settings</a></li>
        </ul>
      </nav>
    </header>
  `;

  /* "Return to top" button, placed after the page content */
  const footerTemplate = `
    <footer class="page-footer">
      <button type="button" class="small-btn" id="return-to-top">Return to top</button>
    </footer>
  `;


  const OWN_SRC = document.currentScript?.src || location.href;   // (currentScript is gone by the time events fire)


  /* =========================================================
     SIDEBAR OPEN / CLOSED STATE
     ========================================================= */

  const root = document.documentElement;
  const isDesktop = window.matchMedia("(min-width: 1024px)");

  /* Remembers whether you closed the sidebar on desktop */
  const navPreference = {
    get()      { try { return localStorage.getItem("navOpen"); } catch { return null; } },
    set(value) { try { localStorage.setItem("navOpen", value); } catch {} },
  };

  /* Opens or closes the sidebar, and keeps the button's aria state in sync */
  function setOpen(open, { save = false } = {}) {
    root.classList.toggle("nav-open", open);
    const button = document.querySelector(".nav-toggle");
    if (button) button.setAttribute("aria-expanded", String(open));
    if (save && isDesktop.matches) navPreference.set(open);   // only remember the desktop choice
  }

  /* Default state: open on desktop (unless you closed it), closed on tablet/phone */
  function initialState() {
    if (!isDesktop.matches) return false;
    return navPreference.get() !== "false";
  }

  /* Set the state right away, before the page paints, so nothing jumps */
  root.classList.toggle("nav-open", initialState());

  /* The browser-tab icon (the logo), so browsers stop asking for a missing favicon.ico */
  if (!document.querySelector("link[rel~='icon']")) {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = new URL("../assets/cobbler-logo.svg", OWN_SRC).href;
    document.head.append(icon);
  }


  /* =========================================================
     OFFLINE AND INSTALL: the service worker (sw.js, at the site's root)
     ---------------------------------------------------------
     Keeps a copy of the app's pages and scripts so they open
     without a connection, and lets the browser offer "Install".
     Registered after the page has loaded so it never slows the
     first visit. When a new version is ready, a note offers to
     reload (only when an older copy was in charge: a first visit
     just gets the new one).
     ========================================================= */
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", async () => {
      try {
        const hadController = !!navigator.serviceWorker.controller;
        const registration = await navigator.serviceWorker.register(new URL("../../sw.js", OWN_SRC).href);
        const offerUpdate = () => {
          if (!hadController) return;
          const reload = () => location.reload();
          if (window.CobblerSync?.toast) CobblerSync.toast("A new version of The Cobbler Project is ready.", [["Reload", reload]], { id: "sw-update" });
        };
        navigator.serviceWorker.addEventListener("controllerchange", offerUpdate, { once: true });
        registration.addEventListener("updatefound", () => {
          registration.installing?.addEventListener("statechange", (event) => {
            if (event.target.state === "installed" && navigator.serviceWorker.controller) offerUpdate();
          });
        });
      } catch (err) {
        console.warn("header.js: the offline copy couldn't be set up:", err);
      }
    });
  }


  /* =========================================================
     BUILD THE SIDEBAR ONCE THE PAGE HAS LOADED
     ========================================================= */
  document.addEventListener("DOMContentLoaded", () => {
    if (document.querySelector(".main-header")) return;   // already built (boot.js sends the event again for the page's scripts)

    /* ---------- Insert the sidebar at the top of the page ---------- */
    document.body.insertAdjacentHTML("afterbegin", headerTemplate);
    setOpen(root.classList.contains("nav-open"));


    /* ---------- Hamburger button toggles the sidebar ---------- */
    document.querySelector(".nav-toggle").addEventListener("click", () =>
      setOpen(!root.classList.contains("nav-open"), { save: true }));


    /* ---------- Small screens: tap the backdrop or press Esc to close ---------- */
    document.querySelector(".nav-backdrop").addEventListener("click", () => setOpen(false));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !isDesktop.matches) setOpen(false);
    });


    /* ---------- Resizing past the desktop width resets to that size's default ---------- */
    isDesktop.addEventListener("change", () => setOpen(initialState()));


    /* ---------- "Return to top" button ---------- */
    document.body.insertAdjacentHTML("beforeend", footerTemplate);

    document.getElementById("return-to-top").addEventListener("click", () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      // keyboard users land back on the menu button instead of the bottom of the page
      document.querySelector(".nav-toggle")?.focus({ preventScroll: true });
    });


    /* ---------- Allow animations only after the first paint ---------- */
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("nav-ready")));
  });
})();
