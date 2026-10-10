/* =========================================================
   resources.js — the Resources page
   ---------------------------------------------------------
   Two tables:
     • Default Resources — read from a CSV file at the top of the
       app (default-resources-cobbler-project.csv, next to index.html).
       To change the table for everyone, replace that file: on GitHub,
       Add file › Upload files, drop in the new CSV with the same
       name, Commit. (Its old place, resources/data/, still works.)
     • Your Resources — rows you add or upload. Saved inside the
       active project, under the key "resources".

   Link cells understand two formats:
     https://example.com            → shows the full address
     [Watch here](https://...)      → shows "Watch here"

   Needs projects-core.js loaded first.
   ========================================================= */
(() => {

  /* ---------- Settings ---------- */

  // Find the CSV relative to THIS script (resources/js/), so it works from any page folder:
  // at the top of the app, or (where it used to be) in resources/data/
  const SCRIPT_URL = document.currentScript.src;
  const DEFAULT_CSV_NAME = "default-resources-cobbler-project.csv";
  const DEFAULT_CSV_URL = new URL(`../../${DEFAULT_CSV_NAME}`, SCRIPT_URL).href;
  const OLD_CSV_URL = new URL(`../data/${DEFAULT_CSV_NAME}`, SCRIPT_URL).href;

  const COLUMNS = ["name", "description", "link"];  // expected CSV columns
  const DATA_KEY = "resources";                     // where this page saves inside the project
  const HIDE_KEY = "defaultTableHidden";            // remembers Hide/Show (same for all projects)
  const EXPORT_FILENAME = "my-resources.csv";


  /* =========================================================
     READING CSV FILES
     ========================================================= */

  /* Guesses the separator from the first line: comma, semicolon or tab */
  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0];
    const counts = { ",": 0, ";": 0, "\t": 0 };
    for (const ch of firstLine) if (ch in counts) counts[ch]++;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  /* Splits CSV text into rows of cells. Handles quotes, commas
     inside quotes and line breaks inside quotes. */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");   // drop the invisible marker Excel adds
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [], field = "", inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }   // "" inside quotes = one quote mark
          else inQuotes = false;
        } else field += c;
      }
      else if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;     // Windows line ending
        row.push(field); rows.push(row); row = []; field = "";
      }
      else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }

    return rows.filter(r => r.some(f => f.trim() !== ""));   // skip blank lines
  }

  /* Turns rows into { name, description, link } objects.
     Uses the header row if it has those names (any order, any capitalisation);
     otherwise assumes the first three columns are in that order. */
  // Other names a spreadsheet's header might use for each column
  const HEADER_NAMES = {
    name:        ["name", "title", "resource", "resource name"],
    description: ["description", "notes", "note", "about", "details", "what it is"],
    link:        ["link", "url", "website", "web address", "address", "links"],
  };
  function toRecords(rows) {
    if (!rows.length) return [];
    const header = rows[0].map(h => h.trim().toLowerCase());
    const found = COLUMNS.map(c => header.findIndex(h => HEADER_NAMES[c].includes(h)));
    const hasHeader = found.some(i => i >= 0);
    const idx = hasHeader ? found.map((i, n) => i >= 0 ? i : (found.includes(n) ? -1 : n)) : [0, 1, 2];

    return rows.slice(hasHeader ? 1 : 0).map(r => ({
      name:        (r[idx[0]] || "").trim(),
      description: (r[idx[1]] || "").trim(),
      link:        (r[idx[2]] || "").trim(),
    }));
  }


  /* =========================================================
     WRITING CSV FILES (Export)
     ========================================================= */

  /* Makes one cell safe for CSV: quotes it if needed, and stops
     spreadsheets treating text like "=SUM(...)" as a formula */
  const csvField = Cobbler.csvField;

  function toCSV(records) {
    const lines = [COLUMNS.join(",")];
    records.forEach(r => lines.push([r.name, r.description, r.link].map(csvField).join(",")));
    return "﻿" + lines.join("\r\n") + "\r\n";   // marker so Excel reads accents correctly
  }

  /* Makes the browser download the table as a .csv file */
  function downloadCSV(records, filename) {
    const blob = new Blob([toCSV(records)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  /* =========================================================
     LINKS
     ========================================================= */

  /* Only allows http, https and mailto links (blocks harmful "javascript:" links).
     Adds https:// if the address has no scheme, e.g. "example.com". */
  function safeUrl(value) {
    if (!value) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = "https://" + value;
    try {
      const url = new URL(value);
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  /* A link that opens in a new tab */
  function makeLink(href, text) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = text;
    return a;
  }

  /* Fills a table cell from the link column.
     [text](url) → link showing "text" (several allowed, one per line)
     plain url   → link showing the url
     anything else → plain text */
  function fillLinkCell(cell, value) {
    const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    let found = false, match;

    while ((match = pattern.exec(value)) !== null) {
      if (found) cell.append(document.createElement("br"));
      found = true;
      const href = safeUrl(match[2]);
      cell.append(href ? makeLink(href, match[1]) : match[1]);
    }
    if (found) return;

    const href = safeUrl(value);
    if (href) cell.append(makeLink(href, value));
    else cell.textContent = value;
  }


  /* =========================================================
     DRAWING A TABLE
     Text is always inserted as plain text, so nothing in a
     CSV file can inject code into the page.
     ========================================================= */

  /* Draws `records` into `container`. Shows `emptyMessage` if there are none.
     If `onRemove` is given, each row gets a Remove button. */
  function renderTable(container, records, emptyMessage, onRemove) {
    container.replaceChildren();

    // Nothing to show
    if (!records.length) {
      const p = document.createElement("p");
      p.textContent = emptyMessage;
      container.append(p);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "table-wrap";   // lets wide tables scroll sideways on phones
    const table = document.createElement("table");
    table.className = "resource-table";

    // Header row
    const headRow = table.createTHead().insertRow();
    const labels = ["Name", "Description", "Link"];
    if (onRemove) labels.push("");
    labels.forEach(label => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      headRow.append(th);
    });

    // One row per record
    const body = table.createTBody();
    records.forEach((rec, i) => {
      const tr = body.insertRow();
      tr.insertCell().textContent = rec.name;
      tr.insertCell().textContent = rec.description;
      fillLinkCell(tr.insertCell(), rec.link);

      if (onRemove) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "small-btn";
        btn.textContent = "Remove";
        btn.setAttribute("aria-label", `Remove ${rec.name}`);
        btn.addEventListener("click", () => onRemove(i));
        tr.insertCell().append(btn);
      }
    });

    wrap.append(table);
    container.append(wrap);
  }


  /* ---------- Display preference (Hide/Show), saved in the browser ---------- */
  const prefs = {
    get(key)        { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  };


  /* =========================================================
     START-UP: wire up the page once it has loaded
     ========================================================= */
  document.addEventListener("DOMContentLoaded", () => {

    /* ---------- Safety check ---------- */
    if (!window.Projects) {
      console.error("resources.js: window.Projects is missing. Load projects-core.js first.");
      return;
    }

    /* ---------- Page elements ---------- */
    const defaultBox = document.getElementById("default-table");
    const myBox      = document.getElementById("uploaded-table");
    const toggleBtn  = document.getElementById("toggle-default");
    const fileInput  = document.getElementById("csv-input");
    const status     = document.getElementById("upload-status");
    const addForm    = document.getElementById("add-form");


    /* =========================================================
       DEFAULT RESOURCES
       ========================================================= */

    function fetchCSV(url) {
      return fetch(url, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });
    }

    /* ---------- Load the default CSV ----------
       Opened as a file (file://): browsers block reading other files, so use the
       generated twin (default-resources-cobbler-project.js) instead.
       On a server or hosted site: always read the real CSV. */
    const useTwin = location.protocol === "file:" && typeof window.DEFAULT_RESOURCES_CSV === "string";
    const loadDefault = useTwin
      ? Promise.resolve(window.DEFAULT_RESOURCES_CSV)
      : fetchCSV(DEFAULT_CSV_URL).catch(() => fetchCSV(OLD_CSV_URL));

    loadDefault
      .then(text => renderTable(defaultBox, toRecords(parseCSV(text)), "The default table is empty."))
      .catch(err => renderTable(defaultBox, [], `Couldn't find ${DEFAULT_CSV_NAME} at the top of the app (${err.message}).`));

    /* ---------- Hide / Show button ---------- */
    function setDefaultHidden(hidden) {
      defaultBox.hidden = hidden;
      toggleBtn.textContent = hidden ? "Show" : "Hide";
      toggleBtn.setAttribute("aria-expanded", String(!hidden));
      prefs.set(HIDE_KEY, String(hidden));
    }
    setDefaultHidden(prefs.get(HIDE_KEY) === "true");
    toggleBtn.addEventListener("click", () => setDefaultHidden(!defaultBox.hidden));


    /* =========================================================
       YOUR RESOURCES (saved in the active project)
       ========================================================= */

    /* ---------- Load, save, draw ---------- */
    let myRows = Projects.getData(DATA_KEY, []);
    if (!Array.isArray(myRows)) myRows = [];

    const save = () => Projects.setData(DATA_KEY, myRows);

    const render = () =>
      renderTable(myBox, myRows, "No resources yet. Add one above or upload a CSV.", removeRow);

    function removeRow(index) {
      const [removed] = myRows.splice(index, 1);
      save();
      render();
      status.textContent = `Removed "${removed.name}".`;
    }

    render();

    /* ---------- Add one resource from the form ---------- */
    addForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(addForm);
      const name        = String(data.get("name")).trim();
      const description = String(data.get("description")).trim();
      const url         = String(data.get("url")).trim();
      const linkText    = String(data.get("text")).trim().replace(/[\[\]]/g, "");

      // URL + link text are saved as [text](url), the same format the CSV uses
      let link = url;
      if (url && linkText) {
        link = `[${linkText}](${url.replace(/\s/g, "%20").replace(/\)/g, "%29")})`;
      }

      myRows.push({ name, description, link });
      save();
      render();
      status.textContent = `Added "${name}".`;
      addForm.reset();
      addForm.elements.name.focus();
    });

    /* ---------- Upload a CSV (adds its rows to your table) ---------- */
    document.getElementById("choose-file").addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const records = toRecords(parseCSV(await file.text()));
        if (!records.length) {
          status.textContent = `"${file.name}" had no rows to show.`;
          return;
        }
        myRows.push(...records);
        save();
        render();
        status.textContent = `Added ${records.length} rows from ${file.name}.`;
      } catch (err) {
        status.textContent = `Couldn't read "${file.name}": ${err.message}`;
        console.error(err);
      } finally {
        fileInput.value = "";   // lets you pick the same file again later
      }
    });

    /* ---------- Export your table as a CSV ---------- */
    document.getElementById("export-csv").addEventListener("click", () => {
      if (!myRows.length) {
        status.textContent = "Nothing to export yet.";
        return;
      }
      downloadCSV(myRows, EXPORT_FILENAME);
      status.textContent = `Exported ${myRows.length} rows to ${EXPORT_FILENAME}.`;
    });

    /* ---------- Clear your table (asks first) ---------- */
    document.getElementById("clear-table").addEventListener("click", () => {
      if (myRows.length && !confirm(`Remove all ${myRows.length} resources from "${Projects.activeName()}"?`)) return;
      myRows = [];
      fileInput.value = "";
      save();
      render();
      status.textContent = "Table cleared.";
    });

    // After an undo, or when changes arrive from elsewhere: draw the table again from what's stored
    document.addEventListener("projects-refresh", (event) => {
      myRows = Projects.getData(DATA_KEY, []);
      if (!Array.isArray(myRows)) myRows = [];
      render();
      event.detail.handled = true;
    });
  });
})();
