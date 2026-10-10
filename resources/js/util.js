/* =========================================================
   util.js — small helpers shared by every page
   ---------------------------------------------------------
   Loaded first on every page (before projects-core.js), with
   nothing of its own to set up. Each page used to carry its own
   copy of these; now they live here as window.Cobbler:

     Cobbler.el(tag, props, ...children)   build an element
     Cobbler.$(id)                          document.getElementById
     Cobbler.newId(prefix)                  "p" + a unique id
     Cobbler.slug(text, fallback)           "My Zine!" → "my-zine"
     Cobbler.plural(n, word)                "3 shots", "1 shot"
     Cobbler.pad(n)                         7 → "07"
     Cobbler.todayISO()                     "2026-10-12" (local date)
     Cobbler.download(data, name, type)     save text or a Blob as a file
     Cobbler.csvField(value)                one cell, safe for CSV
     Cobbler.statusLine(id, ms)             a setStatus(message) for an element

   el(): text children are always added as plain text, so nothing
   typed by a user can inject code into the page.
     el("button", { class: "small-btn", onclick: fn }, "Reply")
   props: class → className; dataset → data-* attributes; on… →
   event listeners; true → an empty attribute; null/false → skipped.
   Children: strings and nodes, nested lists flattened; null, false
   and "" are skipped (so "cond && el(…)" works).
   ========================================================= */
(() => {

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "dataset") Object.assign(node.dataset, value);
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat(Infinity).filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  const $ = (id) => document.getElementById(id);

  // A unique id, e.g. newId("c") → "cmgx4k2m9ab"
  const newId = (prefix = "") => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Safe for file names and addresses: "My Zine!" → "my-zine"
  const slug = (text, fallback = "item") =>
    String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const pad = (n) => String(n).padStart(2, "0");

  // Today as "2026-10-12", in this computer's time zone
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /* Makes the browser download `data` (text, bytes or a Blob) as a file */
  function download(data, filename, type = "text/plain") {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* One CSV cell: quoted when needed, and text like "=SUM(…)" is kept
     from being treated as a formula by spreadsheets */
  function csvField(value) {
    let v = String(value ?? "");
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  /* A function that shows a message in the element with this id and
     clears it after `ms` (0 = leave it) */
  function statusLine(id, ms = 6000) {
    let timer = 0;
    return (message) => {
      const node = $(id);
      if (!node) return;
      node.textContent = message;
      clearTimeout(timer);
      if (message && ms) timer = setTimeout(() => { node.textContent = ""; }, ms);
    };
  }

  window.Cobbler = { el, $, newId, slug, plural, pad, todayISO, download, csvField, statusLine };
})();
