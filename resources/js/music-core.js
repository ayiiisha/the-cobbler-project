/* =========================================================
   music-core.js — the Music page: shared state and tabs
   ---------------------------------------------------------
   Four tabs:
     Songs              music-songs.js     the song sketchbook: lyrics and chords,
                                           sheet music, split sheets, sessions and versions
     Gigs and bookings  music-business.js  shows, fees, advancing, setlists
     Releases           music-business.js  release plans worked back from the release date
     Sample clearances  music-business.js  every sample and where its clearance stands

   Saved inside the active project: project.data.songs, gigs,
   releases, samples (see each tab's file).

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects) return;
  const $ = (id) => document.getElementById(id);

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pad = (n) => String(n).padStart(2, "0");
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return y ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : String(iso);
  };
  const addDays = (iso, n) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const t = new Date(y, m - 1, d + n);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  };
  const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "song";

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let statusTimer = 0;
  function setStatus(message) {
    $("mu-status").textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { $("mu-status").textContent = ""; }, 8000);
  }

  // Lists saved in the project, by key
  const list = (key) => { const v = Projects.getData(key, []); return Array.isArray(v) ? v : []; };
  const saveList = (key, value) => Projects.setData(key, value);

  /* Prints a sheet of content: anything in #mu-print prints on its own */
  function print(nodes, title) {
    const sheet = $("mu-print");
    sheet.replaceChildren(...nodes.flat().filter(n => n != null && n !== false && n !== ""));
    const pageTitle = document.title;
    document.title = title;
    setTimeout(() => { window.print(); document.title = pageTitle; }, 60);
  }
  window.addEventListener("afterprint", () => $("mu-print").replaceChildren());

  const tabs = {};
  let tab = location.hash.slice(1) || "songs";
  function show(name) {
    if (!tabs[name]) name = "songs";
    tab = name;
    document.querySelectorAll("#mu-tabs [role=tab]").forEach(b => {
      const on = b.dataset.tab === name;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    history.replaceState(null, "", name === "songs" ? location.pathname : `#${name}`);
    tabs[name].render($("mu-panel"));
  }

  window.MusicPage = {
    el, $, newId, todayISO, fmtDate, addDays, slug, download, setStatus, list, saveList, print,
    fill(panel, ...nodes) { panel.replaceChildren(...nodes.flat().filter(n => n != null && n !== false && n !== "")); },
    register(name, t) { tabs[name] = t; },
    show, tab: () => tab,
  };

  document.addEventListener("DOMContentLoaded", () => {
    const buttons = [...document.querySelectorAll("#mu-tabs [role=tab]")];
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => show(b.dataset.tab));
      b.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const next = buttons[(i + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
        next.focus(); next.click();
      });
    });
    show(tab);
  });
})();
