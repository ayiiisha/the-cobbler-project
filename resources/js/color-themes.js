/* =========================================================
   color-themes.js — page themes
   ---------------------------------------------------------
   1. Applies your saved theme on every page, as early as possible
   2. On pages with theme buttons (.theme-switcher, on Settings),
      makes the buttons switch and save the theme

   Themes:
     light     white page, dark text
     dark      black page, light text
     rainbow   every surface an accent colour, black/white text
     system    "System Default": light or dark to match the computer's
               setting, switching live when that setting changes

   The theme in use is set as an attribute on <html>:
     <html data-selected-theme="dark" data-theme-choice="system">
   (data-selected-theme is always light, dark or rainbow; style.css
   swaps the colour variables to match. data-theme-choice is what
   you picked.)

   Load WITHOUT defer near the top of <body>, so the right theme
   is in place before the page paints (no flash of light theme).
   ========================================================= */
(() => {

  /* ---------- Settings ---------- */
  const STORAGE_KEY = "selected-theme";
  const DEFAULT_THEME = "light";
  const THEMES = ["light", "dark", "rainbow", "system"];

  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");


  /* ---------- Read the saved theme ---------- */
  const savedTheme = () => {
    try {
      const theme = localStorage.getItem(STORAGE_KEY);
      return THEMES.includes(theme) ? theme : DEFAULT_THEME;
    } catch { return DEFAULT_THEME; }
  };


  /* ---------- Apply a theme (and mark the matching button as pressed) ---------- */
  function applyTheme(choice) {
    const shown = choice === "system" ? (systemDark.matches ? "dark" : "light") : choice;
    const root = document.documentElement;
    root.setAttribute("data-selected-theme", shown);
    root.setAttribute("data-theme-choice", choice);
    document.querySelectorAll(".theme-switcher [data-theme]").forEach(button =>
      button.setAttribute("aria-pressed", String(button.dataset.theme === choice)));
  }


  /* ---------- 1. Apply right away, on every page ---------- */
  applyTheme(savedTheme());

  // System Default: follow the computer when it switches between light and dark.
  // The "change" event does this in most browsers; as a backup, check again when
  // the window comes back into focus and every couple of seconds.
  function followSystem() {
    if (savedTheme() !== "system") return;
    const want = systemDark.matches ? "dark" : "light";
    if (document.documentElement.getAttribute("data-selected-theme") !== want) applyTheme("system");
  }
  systemDark.addEventListener("change", followSystem);
  window.addEventListener("focus", followSystem);
  document.addEventListener("visibilitychange", followSystem);
  setInterval(followSystem, 2000);


  /* ---------- 2. Wire up the theme buttons, if this page has them ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(savedTheme());   // the buttons exist now, so sync their pressed state

    document.querySelectorAll(".theme-switcher [data-theme]").forEach(button => {
      button.addEventListener("click", () => {
        const theme = button.dataset.theme;
        applyTheme(theme);
        try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
      });
    });
  });
})();
