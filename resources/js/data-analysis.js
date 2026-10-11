/* =========================================================
   data-analysis.js — the Data Analysis page
   ---------------------------------------------------------
   Load a CSV, see a profile of each column, filter the rows
   and draw a quick chart. The page writes matching R code
   (tidyverse + ggplot2) to copy or save and run in RStudio.
   It doesn't run R itself.

   Charts can be made two ways (the "Make it with" menu):
     ggplot2      the R code draws the chart and saves a PNG
     Datawrapper  the R code prepares the chart's data and uses
                  Datawrapper's API (via httr2) to create, fill and
                  publish the chart in your Datawrapper account
   Either way the code is written here on the page from fixed
   templates: no internet or AI is needed to produce it.

   Column types are guessed the way R's read_csv() guesses them,
   so the R code sees the same data:
     number   plain numbers like 12, -3.5, 1e6 (not "1,234" or "$5")
     date     2024-01-05;  datetime: 2024-01-05 10:30 or …T10:30:00
     logical  TRUE / FALSE / T / F / true / false
     text     anything else
   Empty cells and "NA" count as missing.

   The CSV itself is kept by file-store.js (IndexedDB). The project
   keeps each dataset's details, filters and chart settings:
     project.data.datasets = [{ id, name, blob, size, rows, cols, added, filters, chart,
                                sheet }]   ← sheet: for an Excel file, which sheet was read

   Excel files (.xlsx) are read in the browser (xlsx-read.js). The
   workbook itself is kept (FileStore), so the sheet can be switched
   later from the dataset bar; the R code then uses readxl::read_excel().
   The Rows section shows the filtered rows a page at a time (pick
   the page and the page size), and the chart's controls name the
   axes explicitly, with a swap button.

   Needs projects-core.js, file-store.js and xlsx-read.js.
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("data-analysis.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);
  const currentKey = () => `dataAnalysisCurrent:${Projects.activeId()}`;   // (a function: the active project can change without a reload)

  /* Chart colours (validated categorical slots 1–3; see style.css section 21).
     Scatter groups beyond three fold into "Other". */
  const GROUP_LIMIT = 3;
  const MAX_POINTS = 4000;   // points drawn in a scatter (R draws them all)
  const BAR_LIMIT = 15;      // bars shown in a bar chart (largest first)


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs = {}, ...children) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    node.append(...children.filter(Boolean));
    return node;
  }

  const newId = () => Cobbler.newId("d");
  const fmtInt = (n) => n.toLocaleString();

  // Numbers for display: 12,345 · 3.14 · 0.0021 · 1.2e9
  function fmt(n) {
    if (n == null || Number.isNaN(n)) return "–";
    const a = Math.abs(n);
    if (a !== 0 && (a >= 1e9 || a < 1e-3)) return n.toExponential(2);
    return n.toLocaleString(undefined, { maximumFractionDigits: a >= 100 ? 1 : a >= 1 ? 2 : 4 });
  }

  const pad = Cobbler.pad;
  const isoDay = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const fmtDate = (ms, withTime) => withTime ? `${isoDay(ms)} ${pad(new Date(ms).getUTCHours())}:${pad(new Date(ms).getUTCMinutes())}` : isoDay(ms);

  const download = Cobbler.download;

  const setStatus = Cobbler.statusLine("da-status", 9000);


  /* =========================================================
     READING THE CSV
     ========================================================= */

  /* Splits CSV text into rows of cells. Handles quotes, separators and
     line breaks inside quotes. The separator (comma, semicolon or tab)
     is guessed from the first line. */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0];
    const counts = { ",": 0, ";": 0, "\t": 0 };
    for (const ch of first) if (ch in counts) counts[ch]++;
    const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return { rows: rows.filter(r => r.some(f => f.trim() !== "")), delim };
  }

  /* Column names the way read_csv() makes them: blanks become ...3,
     repeated names become name...2 and name...5 */
  function columnNames(header) {
    const seen = {};
    header.forEach(h => { const k = h.trim(); seen[k] = (seen[k] || 0) + 1; });
    return header.map((h, i) => {
      const k = h.trim();
      if (!k) return `...${i + 1}`;
      return seen[k] > 1 ? `${k}...${i + 1}` : k;
    });
  }

  const isMissing = (v) => v == null || v.trim() === "" || v.trim() === "NA";
  const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/;
  const LOGICAL = { TRUE: true, T: true, true: true, True: true, FALSE: false, F: false, false: false, False: false };

  /* Builds typed columns from the rows */
  function buildTable(text) {
    const { rows } = parseCSV(text);
    if (rows.length < 2) throw new Error("it needs a header row and at least one row of data");
    const names = columnNames(rows[0]);
    const body = rows.slice(1);

    const columns = names.map((name, c) => {
      const raw = body.map(r => r[c] ?? "");
      const present = raw.filter(v => !isMissing(v)).map(v => v.trim());
      let type = "text";
      if (present.length) {
        if (present.every(v => v in LOGICAL)) type = "logical";
        else if (present.every(v => NUMBER.test(v))) type = "number";
        else if (present.every(v => DATE.test(v))) type = "date";
        else if (present.every(v => DATE.test(v) || DATETIME.test(v))) type = "datetime";
      }
      const parse = {
        number: (v) => Number(v),
        logical: (v) => LOGICAL[v],
        date: (v) => Date.parse(v + "T00:00:00Z"),
        datetime: (v) => Date.parse(DATE.test(v) ? v + "T00:00:00Z" : v.replace(" ", "T").replace(/Z?$/, "Z")),
        text: (v) => v,
      }[type];
      const values = raw.map(v => isMissing(v) ? null : parse(v.trim()));
      return { name, index: c, type, values };
    });
    return { columns, rowCount: body.length, body };
  }


  /* =========================================================
     PROFILE (one card per column)
     ========================================================= */

  function profileOf(col) {
    const present = col.values.filter(v => v != null);
    const p = { n: col.values.length, missing: col.values.length - present.length, unique: new Set(present).size };
    if (col.type === "number" || col.type === "date" || col.type === "datetime") {
      const sorted = [...present].sort((a, b) => a - b);
      p.min = sorted[0];
      p.max = sorted[sorted.length - 1];
      if (col.type === "number" && sorted.length) {
        p.mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        const mid = sorted.length >> 1;
        p.median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        p.sd = sorted.length > 1 ? Math.sqrt(sorted.reduce((s, v) => s + (v - p.mean) ** 2, 0) / (sorted.length - 1)) : 0;
      }
      p.bins = binValues(sorted, 20);
    } else {
      const counts = new Map();
      present.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
      p.top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    }
    return p;
  }

  /* Equal-width bins: [{ from, to, count }] */
  function binValues(sorted, count) {
    if (!sorted.length) return [];
    const min = sorted[0], max = sorted[sorted.length - 1];
    if (min === max) return [{ from: min, to: max, count: sorted.length }];
    const width = (max - min) / count;
    const bins = Array.from({ length: count }, (_, i) => ({ from: min + i * width, to: min + (i + 1) * width, count: 0 }));
    sorted.forEach(v => bins[Math.min(count - 1, Math.floor((v - min) / width))].count++);
    return bins;
  }

  const TYPE_NAMES = { number: "Number", date: "Date", datetime: "Date & time", logical: "True / false", text: "Text" };

  function renderProfile() {
    $("da-profile").replaceChildren(...S.table.columns.map(col => {
      const p = profileOf(col);
      const facts = [
        ["Missing", `${fmtInt(p.missing)} (${p.n ? Math.round(p.missing / p.n * 100) : 0}%)`],
        ["Unique", fmtInt(p.unique)],
      ];
      if (col.type === "number") {
        facts.push(["Min", fmt(p.min)], ["Median", fmt(p.median)], ["Mean", fmt(p.mean)], ["Max", fmt(p.max)], ["Std dev", fmt(p.sd)]);
      }
      if (col.type === "date" || col.type === "datetime") {
        facts.push(["From", p.min != null ? fmtDate(p.min, col.type === "datetime") : "–"], ["To", p.max != null ? fmtDate(p.max, col.type === "datetime") : "–"]);
      }

      let picture = null;
      if (p.bins?.length > 1) picture = miniHistogram(p.bins);
      if (p.top?.length) {
        const most = p.top[0][1];
        picture = el("ul", { class: "da-top" }, p.top.map(([value, count]) => {
          const bar = el("span", { class: "da-top-bar", "aria-hidden": "true" });
          bar.style.width = `${(count / most) * 100}%`;
          return el("li", { title: `${value}: ${fmtInt(count)}` },
            el("span", { class: "da-top-label" }, String(value)), bar, el("span", { class: "da-top-n" }, fmtInt(count)));
        }));
      }

      return el("article", { class: "da-col" },
        el("header", { class: "da-col-head" }, el("h3", { title: col.name }, col.name), el("span", { class: `da-type is-${col.type}` }, TYPE_NAMES[col.type])),
        el("dl", { class: "da-facts" }, facts.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
        picture);
    }));
  }

  // A tiny histogram (shape only) for profile cards
  function miniHistogram(bins) {
    const most = Math.max(...bins.map(b => b.count)) || 1;
    const w = 100 / bins.length;
    return svg("svg", { class: "da-mini", viewBox: "0 0 100 30", preserveAspectRatio: "none", "aria-hidden": "true" },
      ...bins.map((b, i) => svg("rect", { x: (i * w + 0.4).toFixed(2), y: (30 - b.count / most * 30).toFixed(2), width: (w - 0.8).toFixed(2), height: (b.count / most * 30).toFixed(2) })));
  }


  /* =========================================================
     FILTERS
     Rules: { col, op, value, value2 }. Rules (other than "is missing")
     leave out missing values, the same as R's filter().
     ========================================================= */

  const OPS = {
    number:   [["=", "equals"], ["!=", "doesn't equal"], [">", "greater than"], [">=", "at least"], ["<", "less than"], ["<=", "at most"], ["between", "between"], ["missing", "is missing"], ["present", "isn't missing"]],
    text:     [["is", "is"], ["isnot", "isn't"], ["contains", "contains"], ["notcontains", "doesn't contain"], ["oneof", "is one of"], ["missing", "is missing"], ["present", "isn't missing"]],
    date:     [["on", "on"], ["before", "before"], ["after", "after"], ["between", "between"], ["missing", "is missing"], ["present", "isn't missing"]],
    logical:  [["true", "is TRUE"], ["false", "is FALSE"], ["missing", "is missing"], ["present", "isn't missing"]],
  };
  const opsFor = (col) => OPS[col.type === "datetime" ? "date" : col.type];
  const needsValue = (op) => !["missing", "present", "true", "false"].includes(op);
  const dayStart = (iso) => Date.parse(iso + "T00:00:00Z");
  const oneOf = (text) => text.split(",").map(s => s.trim()).filter(Boolean);

  /* A test for one rule, or null if the rule isn't complete yet */
  function ruleTest(rule) {
    const col = S.table.columns.find(c => c.name === rule.col);
    if (!col) return null;
    const { op } = rule;
    if (op === "missing") return (v) => v == null;
    if (op === "present") return (v) => v != null;
    if (op === "true") return (v) => v === true;
    if (op === "false") return (v) => v === false;
    const a = rule.value ?? "", b = rule.value2 ?? "";
    if (a === "" || (op === "between" && b === "")) return null;

    if (col.type === "number") {
      const x = Number(a), y = Number(b);
      if (Number.isNaN(x) || (op === "between" && Number.isNaN(y))) return null;
      return {
        "=": (v) => v === x, "!=": (v) => v != null && v !== x, ">": (v) => v > x, ">=": (v) => v >= x,
        "<": (v) => v != null && v < x, "<=": (v) => v != null && v <= x,
        between: (v) => v != null && v >= Math.min(x, y) && v <= Math.max(x, y),
      }[op];
    }
    if (col.type === "date" || col.type === "datetime") {
      if (!DATE.test(a) || (op === "between" && !DATE.test(b))) return null;
      const x = dayStart(a), y = op === "between" ? dayStart(b) : 0;
      const DAY = 86400000;
      return {
        on: (v) => v != null && v >= x && v < x + DAY,
        before: (v) => v != null && v < x,
        after: (v) => v != null && v >= x + DAY,
        between: (v) => v != null && v >= Math.min(x, y) && v < Math.max(x, y) + DAY,
      }[op];
    }
    const lower = a.toLowerCase();
    return {
      is: (v) => v === a, isnot: (v) => v != null && v !== a,
      contains: (v) => v != null && v.toLowerCase().includes(lower),
      notcontains: (v) => v != null && !v.toLowerCase().includes(lower),
      oneof: (v) => v != null && oneOf(a).includes(v),
    }[op];
  }

  /* Indexes of the rows that pass every complete rule */
  function filteredRows() {
    const tests = S.meta.filters.map(rule => ({ test: ruleTest(rule), col: S.table.columns.find(c => c.name === rule.col) }))
      .filter(t => t.test && t.col);
    const out = [];
    for (let r = 0; r < S.table.rowCount; r++) {
      if (tests.every(t => t.test(t.col.values[r]))) out.push(r);
    }
    return out;
  }

  function renderFilters() {
    const box = $("da-filters");
    const { columns } = S.table;
    if (!S.meta.filters.length) {
      box.replaceChildren(el("p", { class: "media-muted" }, "No filters: every row is included."));
      return;
    }
    box.replaceChildren(...S.meta.filters.map((rule, i) => {
      const col = columns.find(c => c.name === rule.col) || columns[0];
      const colSelect = el("select", { class: "team-select", "aria-label": "Column" }, columns.map(c => el("option", { value: c.name }, c.name)));
      colSelect.value = col.name;
      colSelect.addEventListener("change", () => {
        const next = columns.find(c => c.name === colSelect.value);
        Object.assign(rule, { col: next.name, op: opsFor(next)[0][0], value: "", value2: "" });
        changed({ filters: true });
      });

      const opSelect = el("select", { class: "team-select", "aria-label": "Condition" }, opsFor(col).map(([v, n]) => el("option", { value: v }, n)));
      opSelect.value = rule.op;
      opSelect.addEventListener("change", () => { rule.op = opSelect.value; changed({ filters: true }); });

      const isDate = col.type === "date" || col.type === "datetime";
      const input = (key, label) => {
        const box = el("input", { class: "da-value", "aria-label": label, value: rule[key] || "",
          type: isDate ? "date" : col.type === "number" ? "number" : "text", step: col.type === "number" ? "any" : null,
          placeholder: rule.op === "oneof" ? "a, b, c" : "", list: col.type === "text" ? `da-values-${col.index}` : null });
        box.addEventListener("change", () => { rule[key] = box.value; changed({ filtersQuiet: true }); });
        return box;
      };
      const hint = ruleTest(rule) === null && needsValue(rule.op) && el("span", { class: "transcript-warning" }, "Fill in a value");

      // Suggestions for text columns: its most common values
      const suggestions = col.type === "text" && el("datalist", { id: `da-values-${col.index}` },
        (profileOf(col).top || []).map(([v]) => el("option", { value: v })));

      return el("div", { class: "da-filter" },
        colSelect, opSelect,
        needsValue(rule.op) && input("value", "Value"),
        rule.op === "between" && el("span", {}, "and"),
        rule.op === "between" && input("value2", "Second value"),
        hint, suggestions,
        el("button", { type: "button", class: "comment-action", "aria-label": "Remove filter", onclick: () => {
          S.meta.filters.splice(i, 1);
          changed({ filters: true });
        } }, "Remove"));
    }));
  }


  /* =========================================================
     CHART
     settings: { type: "histogram" | "bar" | "scatter" | "line",
                 x, y, agg: "count" | "sum" | "mean" | "median", group,
                 bins, period: "day" | "week" | "month" | "year", table }
     ========================================================= */

  const CHART_TYPES = {
    histogram: "Histogram (spread of one number)",
    bar: "Bar (compare groups)",
    scatter: "Scatter (two numbers)",
    line: "Line (change over time)",
  };

  const numeric = (c) => c.type === "number";
  const timeLike = (c) => c.type === "date" || c.type === "datetime";
  const groupLike = (c) => c.type === "text" || c.type === "logical";

  // Fills in sensible columns for the chosen chart type
  function fixChart() {
    const ch = S.meta.chart;
    const cols = S.table.columns;
    const pick = (ok, current) => cols.find(c => c.name === current && ok(c))?.name || cols.find(ok)?.name || "";
    ch.type = CHART_TYPES[ch.type] ? ch.type : (cols.some(timeLike) ? "line" : cols.some(numeric) ? "histogram" : "bar");
    ch.agg ||= "count";
    ch.bins ||= 30;
    ch.period ||= "month";
    ch.tool = ch.tool === "datawrapper" ? "datawrapper" : "ggplot";
    if (ch.type === "histogram") ch.x = pick(c => numeric(c) || timeLike(c), ch.x);
    if (ch.type === "bar") ch.x = pick(groupLike, ch.x) || pick(() => true, ch.x);
    if (ch.type === "scatter") {
      ch.x = pick(c => numeric(c) || timeLike(c), ch.x);
      ch.y = pick(c => (numeric(c) || timeLike(c)) && c.name !== ch.x, ch.y) || pick(c => numeric(c) || timeLike(c), ch.y);
    }
    if (ch.type === "line") ch.x = pick(timeLike, ch.x) || pick(numeric, ch.x);
    if (ch.agg !== "count" && ch.type !== "histogram" && ch.type !== "scatter") ch.y = pick(numeric, ch.y);
    if (ch.group && !cols.some(c => c.name === ch.group && groupLike(c))) ch.group = "";
  }

  function renderChartControls() {
    const ch = S.meta.chart;
    const cols = S.table.columns;
    const select = (label, key, options, onChange) => {
      const s = el("select", { class: "team-select", "aria-label": label }, options.map(([v, n]) => el("option", { value: v }, n)));
      s.value = ch[key] ?? "";
      s.addEventListener("change", () => { ch[key] = s.value; onChange?.(); changed({ chart: true }); });
      return el("label", { class: "tool-group" }, label, s);
    };
    const colOptions = (ok) => cols.filter(ok).map(c => [c.name, c.name]);

    const parts = [
      select("Make it with", "tool", [["ggplot", "ggplot2 (R)"], ["datawrapper", "Datawrapper (API, from R)"]]),
      select("Chart", "type", Object.entries(CHART_TYPES)),
    ];
    // Swap the axes: for scatter and line the two variables change places; for bars the chart turns sideways
    const swappable = ch.type === "scatter" || (ch.type === "line" && ch.agg !== "count") || ch.type === "bar";
    const swap = el("button", { type: "button", class: "small-btn", disabled: !swappable, title: ch.type === "bar" ? "Draw the bars sideways" : "Put the x variable on the y axis and the other way round", onclick: () => {
      if (ch.type === "bar") ch.horizontal = !ch.horizontal;
      else if (ch.type === "line" && ch.agg !== "count") { ch.type = "scatter"; [ch.x, ch.y] = [ch.y, ch.x]; }
      else [ch.x, ch.y] = [ch.y, ch.x];
      changed({ chart: true });
    } }, "⇄ Swap axes");
    if (ch.type === "histogram") {
      parts.push(select("Variable (x)", "x", colOptions(c => numeric(c) || timeLike(c))));
      const bins = el("input", { type: "number", min: "5", max: "100", value: String(ch.bins), class: "te-seconds", "aria-label": "Bins" });
      bins.addEventListener("change", () => { ch.bins = Math.min(100, Math.max(5, Number(bins.value) || 30)); changed({ chart: true }); });
      parts.push(el("label", { class: "tool-group" }, "Bins", bins));
    }
    if (ch.type === "bar" || ch.type === "line") {
      parts.push(select(ch.type === "bar" ? (ch.horizontal ? "Groups (y axis)" : "Groups (x axis)") : "x axis (over)", "x", colOptions(ch.type === "bar" ? () => true : (c) => timeLike(c) || numeric(c))));
      if (ch.type === "line" && timeLike(cols.find(c => c.name === ch.x) || {})) {
        parts.push(select("By", "period", [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]]));
      }
      parts.push(select(ch.type === "bar" ? (ch.horizontal ? "Length (x axis)" : "Height (y axis)") : "y axis", "agg", [["count", "Number of rows"], ["sum", "Sum of…"], ["mean", "Average of…"], ["median", "Median of…"]]));
      if (ch.agg !== "count") parts.push(select("Of variable", "y", colOptions(numeric)));
    }
    if (ch.type === "scatter") {
      parts.push(select("x axis", "x", colOptions(c => numeric(c) || timeLike(c))));
      parts.push(select("y axis", "y", colOptions(c => numeric(c) || timeLike(c))));
      parts.push(select("Colour by", "group", [["", "Nothing"], ...colOptions(groupLike)]));
    }
    parts.push(swap);
    const table = el("input", { type: "checkbox", checked: !!ch.table });
    table.addEventListener("change", () => { ch.table = table.checked; changed({ chart: true }); });
    parts.push(el("label", { class: "tool-group" }, table, "Show as a table"));
    $("da-chart-controls").replaceChildren(...parts);
  }

  /* ---------- Turning rows into what the chart draws ---------- */

  function aggregate(values) {
    const agg = S.meta.chart.agg;
    if (agg === "count") return values.length;
    const nums = values.filter(v => v != null);
    if (!nums.length) return null;
    if (agg === "sum") return nums.reduce((s, v) => s + v, 0);
    if (agg === "mean") return nums.reduce((s, v) => s + v, 0) / nums.length;
    const sorted = [...nums].sort((a, b) => a - b), mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // Start of the day / week (Monday) / month / year, in UTC
  function floorDate(ms, period) {
    const d = new Date(ms);
    if (period === "year") return Date.UTC(d.getUTCFullYear(), 0, 1);
    if (period === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (period === "week") return day - ((d.getUTCDay() + 6) % 7) * 86400000;
    return day;
  }

  function chartData(rows) {
    const ch = S.meta.chart;
    const col = (name) => S.table.columns.find(c => c.name === name);
    const X = col(ch.x), Y = col(ch.y);
    if (!X) return null;

    if (ch.type === "histogram") {
      const sorted = rows.map(r => X.values[r]).filter(v => v != null).sort((a, b) => a - b);
      return { kind: "histogram", x: X, bins: binValues(sorted, ch.bins), total: sorted.length };
    }
    if (ch.type === "bar") {
      const groups = new Map();
      rows.forEach(r => {
        const key = X.values[r] == null ? "(missing)" : String(X.values[r]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ch.agg === "count" ? 1 : Y?.values[r]);
      });
      const bars = [...groups.entries()].map(([label, vals]) => ({ label, value: aggregate(vals) }))
        .filter(b => b.value != null).sort((a, b) => b.value - a.value);
      return { kind: "bar", x: X, y: Y, bars: bars.slice(0, BAR_LIMIT), hidden: Math.max(0, bars.length - BAR_LIMIT) };
    }
    if (ch.type === "line") {
      const groups = new Map();
      rows.forEach(r => {
        const v = X.values[r];
        if (v == null) return;
        const key = timeLike(X) ? floorDate(v, ch.period) : v;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ch.agg === "count" ? 1 : Y?.values[r]);
      });
      const points = [...groups.entries()].map(([x, vals]) => ({ x, y: aggregate(vals) })).filter(p => p.y != null).sort((a, b) => a.x - b.x);
      return { kind: "line", x: X, y: Y, points };
    }
    // Scatter: up to three groups, the rest as "Other". The groups (and so
    // their colours) come from the whole dataset, so filtering never repaints them.
    if (!Y) return null;
    const G = col(ch.group);
    const kept = G ? colouredGroups(G) : [];
    const present = new Set(G ? rows.map(r => String(G.values[r] ?? "(missing)")) : []);
    let points = rows.map(r => ({
      x: X.values[r], y: Y.values[r], row: r,
      group: G ? (kept.includes(String(G.values[r] ?? "(missing)")) ? String(G.values[r] ?? "(missing)") : "Other") : "",
    })).filter(p => p.x != null && p.y != null);
    const total = points.length;
    if (points.length > MAX_POINTS) {   // an even sample, so the shape stays true
      const step = points.length / MAX_POINTS;
      points = Array.from({ length: MAX_POINTS }, (_, i) => points[Math.floor(i * step)]);
    }
    const hasOther = points.some(p => p.group === "Other");
    const series = G ? [...kept.filter(g => present.has(g)), ...(hasOther ? ["Other"] : [])] : [];
    return { kind: "scatter", x: X, y: Y, group: G, kept, series, points, total };
  }

  /* The three biggest groups in the whole dataset, in a fixed order */
  function colouredGroups(G) {
    const counts = new Map();
    G.values.forEach(v => { const g = v == null ? "(missing)" : String(v); counts.set(g, (counts.get(g) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, GROUP_LIMIT).map(e => e[0]);
  }

  /* ---------- Scales and ticks ---------- */

  function niceTicks(min, max, count = 5) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;   // about `count` gaps
    // From the round number at or below the smallest value to the one at or above the largest,
    // so every mark sits inside the axis
    const ticks = [];
    const last = Math.ceil(max / step - 1e-9) * step;
    for (let t = Math.floor(min / step + 1e-9) * step; t <= last + step * 1e-9; t += step) ticks.push(Math.round(t / step) * step);
    return ticks;
  }
  function timeTicks(min, max) {
    const span = max - min, DAY = 86400000;
    const ticks = [];
    const d = new Date(min);
    if (span > 3 * 365 * DAY) {
      const years = Math.max(1, Math.ceil(span / (365 * DAY) / 6));
      for (let y = d.getUTCFullYear(); Date.UTC(y, 0, 1) <= max; y += years) if (Date.UTC(y, 0, 1) >= min) ticks.push(Date.UTC(y, 0, 1));
      return { ticks, label: (t) => String(new Date(t).getUTCFullYear()) };
    }
    if (span > 60 * DAY) {
      const months = Math.max(1, Math.ceil(span / (30 * DAY) / 6));
      for (let m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); m <= max; m = Date.UTC(new Date(m).getUTCFullYear(), new Date(m).getUTCMonth() + months, 1)) if (m >= min) ticks.push(m);
      return { ticks, label: (t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) };
    }
    const days = Math.max(1, Math.ceil(span / DAY / 6));
    for (let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); t <= max; t += days * DAY) if (t >= min) ticks.push(t);
    return { ticks, label: (t) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) };
  }

  /* ---------- Drawing ---------- */

  function renderChart(rows) {
    const box = $("da-chart");
    const ch = S.meta.chart;
    const data = chartData(rows);
    if (!data || (data.kind === "histogram" && !data.total) || (data.kind === "bar" && !data.bars.length) ||
        (data.kind === "line" && !data.points.length) || (data.kind === "scatter" && !data.points.length)) {
      box.replaceChildren(el("p", { class: "media-empty" }, "Nothing to draw. Pick other columns, or loosen the filters."));
      return data;
    }
    if (ch.table) { box.replaceChildren(chartTable(data)); return data; }

    const width = Math.max(320, box.clientWidth || 700);
    const height = 340;
    const sideways = data.kind === "bar" && !!ch.horizontal;
    const m = { top: 16, right: 18, bottom: data.kind === "bar" && !sideways ? 78 : 44, left: sideways ? 130 : 64 };
    const W = width - m.left - m.right, H = height - m.top - m.bottom;
    const root = svg("svg", { class: "da-svg", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": chartTitle(data) });
    const plot = svg("g", { transform: `translate(${m.left} ${m.top})` });
    root.append(plot);
    const tip = el("div", { class: "da-tip", hidden: true });

    const show = (event, lines) => {
      tip.replaceChildren(...lines.map((l, i) => i === 0 ? el("strong", {}, l) : el("span", {}, l)));
      tip.hidden = false;
      const r = box.getBoundingClientRect();
      tip.style.left = `${Math.min(r.width - 180, Math.max(0, event.clientX - r.left + 12))}px`;
      tip.style.top = `${Math.max(0, event.clientY - r.top - 12)}px`;
    };
    const hide = () => { tip.hidden = true; };

    const yAxis = (ticks, scale, label) => {
      ticks.forEach(t => plot.append(
        svg("line", { class: "da-grid", x1: 0, x2: W, y1: scale(t), y2: scale(t) }),
        svg("text", { class: "da-tick", x: -8, y: scale(t), "text-anchor": "end", "dominant-baseline": "middle" }, document.createTextNode(fmt(t)))));
      root.append(svg("text", { class: "da-axis-label", x: 14, y: m.top + H / 2, transform: `rotate(-90 14 ${m.top + H / 2})`, "text-anchor": "middle" }, document.createTextNode(label)));
    };
    const xAxisLabel = (label) => root.append(svg("text", { class: "da-axis-label", x: m.left + W / 2, y: height - 6, "text-anchor": "middle" }, document.createTextNode(label)));
    const baseline = () => plot.append(svg("line", { class: "da-baseline", x1: 0, x2: W, y1: H, y2: H }));

    // A bar with rounded top corners, sitting on the baseline
    const barPath = (x, y, w, h) => {
      const r = Math.min(4, w / 2, h);
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    };
    const isTime = timeLike(data.x);
    const xLabel = (v) => isTime ? fmtDate(v, data.x.type === "datetime") : fmt(v);

    if (data.kind === "histogram") {
      const max = Math.max(...data.bins.map(b => b.count));
      const yt = niceTicks(0, max);
      const ys = (v) => H - v / yt[yt.length - 1] * H;
      const lo = data.bins[0].from, hi = data.bins[data.bins.length - 1].to;
      const xs = (v) => hi === lo ? W / 2 : (v - lo) / (hi - lo) * W;
      yAxis(yt, ys, "Rows");
      const xt = isTime ? timeTicks(lo, hi) : { ticks: niceTicks(lo, hi), label: fmt };
      xt.ticks.filter(t => t >= lo && t <= hi).forEach(t => plot.append(svg("text", { class: "da-tick", x: xs(t), y: H + 18, "text-anchor": "middle" }, document.createTextNode(xt.label(t)))));
      data.bins.forEach(b => {
        const x = xs(b.from) + 1, w = Math.max(1, xs(b.to) - xs(b.from) - 2), y = ys(b.count);
        if (b.count) plot.append(svg("path", { class: "da-mark", d: barPath(x, y, w, H - y) }));
        const hit = svg("rect", { class: "da-hit", x: xs(b.from), y: 0, width: Math.max(1, xs(b.to) - xs(b.from)), height: H });
        hit.addEventListener("mousemove", (e) => show(e, [`${xLabel(b.from)} – ${xLabel(b.to)}`, `${fmtInt(b.count)} rows`]));
        hit.addEventListener("mouseleave", hide);
        plot.append(hit);
      });
      baseline();
      xAxisLabel(data.x.name);
    }

    if (data.kind === "bar" && sideways) {
      // Bars running left to right: labels down the left, values along the bottom
      const max = Math.max(0, ...data.bars.map(b => b.value));
      const min = Math.min(0, ...data.bars.map(b => b.value));
      const xt = niceTicks(min, max);
      const right = xt[xt.length - 1], left = Math.min(0, xt[0]);
      const xs = (v) => (v - left) / (right - left) * W;
      xt.forEach(t => plot.append(
        svg("line", { class: "da-grid", x1: xs(t), x2: xs(t), y1: 0, y2: H }),
        svg("text", { class: "da-tick", x: xs(t), y: H + 18, "text-anchor": "middle" }, document.createTextNode(fmt(t)))));
      xAxisLabel(valueLabel(data));
      const band = H / data.bars.length;
      const bh = Math.max(2, Math.min(32, band - 2));
      data.bars.forEach((b, i) => {
        const y = i * band + (band - bh) / 2;
        const x0 = xs(0), x1 = xs(b.value);
        plot.append(svg("rect", { class: "da-mark", x: Math.min(x0, x1), y, width: Math.abs(x1 - x0), height: bh, rx: 3 }));
        const label = b.label.length > 18 ? b.label.slice(0, 17) + "…" : b.label;
        plot.append(svg("text", { class: "da-tick", x: -8, y: y + bh / 2, "text-anchor": "end", "dominant-baseline": "middle" }, document.createTextNode(label)));
        const hit = svg("rect", { class: "da-hit", x: 0, y: i * band, width: W, height: band });
        hit.addEventListener("mousemove", (e) => show(e, [b.label, `${valueLabel(data)}: ${fmt(b.value)}`]));
        hit.addEventListener("mouseleave", hide);
        plot.append(hit);
      });
      plot.append(svg("line", { class: "da-baseline", x1: xs(0), x2: xs(0), y1: 0, y2: H }));
    } else if (data.kind === "bar") {
      const max = Math.max(0, ...data.bars.map(b => b.value));
      const min = Math.min(0, ...data.bars.map(b => b.value));
      const yt = niceTicks(min, max);
      const top = yt[yt.length - 1], bottom = Math.min(0, yt[0]);
      const ys = (v) => H - (v - bottom) / (top - bottom) * H;
      yAxis(yt, ys, valueLabel(data));
      const band = W / data.bars.length;
      const bw = Math.max(2, Math.min(56, band - 2));   // 2px gap between bars
      data.bars.forEach((b, i) => {
        const x = i * band + (band - bw) / 2;
        const y0 = ys(0), y1 = ys(b.value);
        plot.append(svg("path", { class: "da-mark", d: b.value >= 0 ? barPath(x, y1, bw, y0 - y1) : `M${x},${y0}H${x + bw}V${y1}H${x}Z` }));
        const label = b.label.length > 14 ? b.label.slice(0, 13) + "…" : b.label;
        plot.append(svg("text", { class: "da-tick", x: x + bw / 2, y: H + 12, "text-anchor": "end", transform: `rotate(-35 ${x + bw / 2} ${H + 12})` }, document.createTextNode(label)));
        const hit = svg("rect", { class: "da-hit", x: i * band, y: 0, width: band, height: H });
        hit.addEventListener("mousemove", (e) => show(e, [b.label, `${valueLabel(data)}: ${fmt(b.value)}`]));
        hit.addEventListener("mouseleave", hide);
        plot.append(hit);
      });
      plot.append(svg("line", { class: "da-baseline", x1: 0, x2: W, y1: ys(0), y2: ys(0) }));
    }

    if (data.kind === "line") {
      const xs0 = data.points.map(p => p.x), ys0 = data.points.map(p => p.y);
      const lo = Math.min(...xs0), hi = Math.max(...xs0);
      const yt = niceTicks(Math.min(0, ...ys0), Math.max(...ys0));
      const ys = (v) => H - (v - yt[0]) / (yt[yt.length - 1] - yt[0]) * H;
      const xs = (v) => hi === lo ? W / 2 : (v - lo) / (hi - lo) * W;
      yAxis(yt, ys, valueLabel(data));
      const xt = isTime ? timeTicks(lo, hi) : { ticks: niceTicks(lo, hi), label: fmt };
      xt.ticks.filter(t => t >= lo && t <= hi).forEach(t => plot.append(svg("text", { class: "da-tick", x: xs(t), y: H + 18, "text-anchor": "middle" }, document.createTextNode(xt.label(t)))));
      baseline();
      plot.append(svg("path", { class: "da-line", d: data.points.map((p, i) => `${i ? "L" : "M"}${xs(p.x).toFixed(1)},${ys(p.y).toFixed(1)}`).join("") }));
      if (data.points.length <= 60) data.points.forEach(p => plot.append(svg("circle", { class: "da-dot", cx: xs(p.x), cy: ys(p.y), r: 3 })));

      // Crosshair: the nearest point to the pointer
      const cross = svg("line", { class: "da-cross", x1: 0, x2: 0, y1: 0, y2: H, visibility: "hidden" });
      const focus = svg("circle", { class: "da-focus", r: 5, visibility: "hidden" });
      const hit = svg("rect", { class: "da-hit", x: 0, y: 0, width: W, height: H });
      hit.addEventListener("mousemove", (e) => {
        const r = hit.getBoundingClientRect();
        const at = lo + (e.clientX - r.left) / r.width * (hi - lo);
        const p = data.points.reduce((best, q) => Math.abs(q.x - at) < Math.abs(best.x - at) ? q : best);
        cross.setAttribute("x1", xs(p.x)); cross.setAttribute("x2", xs(p.x)); cross.setAttribute("visibility", "visible");
        focus.setAttribute("cx", xs(p.x)); focus.setAttribute("cy", ys(p.y)); focus.setAttribute("visibility", "visible");
        const when = isTime ? periodLabel(p.x) : fmt(p.x);
        show(e, [when, `${valueLabel(data)}: ${fmt(p.y)}`]);
      });
      hit.addEventListener("mouseleave", () => { hide(); cross.setAttribute("visibility", "hidden"); focus.setAttribute("visibility", "hidden"); });
      plot.append(cross, focus, hit);
      xAxisLabel(isTime ? `${data.x.name} (by ${S.meta.chart.period})` : data.x.name);
    }

    if (data.kind === "scatter") {
      const xv = data.points.map(p => p.x), yv = data.points.map(p => p.y);
      const xlo = Math.min(...xv), xhi = Math.max(...xv);
      const yt = niceTicks(Math.min(...yv), Math.max(...yv));
      const ys = (v) => H - (v - yt[0]) / (yt[yt.length - 1] - yt[0]) * H;
      const xt = isTime ? timeTicks(xlo, xhi) : { ticks: niceTicks(xlo, xhi), label: fmt };
      const x0 = isTime ? xlo : Math.min(xlo, xt.ticks[0]), x1 = isTime ? xhi : Math.max(xhi, xt.ticks[xt.ticks.length - 1]);
      const xs = (v) => x1 === x0 ? W / 2 : (v - x0) / (x1 - x0) * W;
      yAxis(yt, ys, data.y.name);
      xt.ticks.filter(t => t >= x0 && t <= x1).forEach(t => plot.append(svg("text", { class: "da-tick", x: xs(t), y: H + 18, "text-anchor": "middle" }, document.createTextNode(xt.label(t)))));
      baseline();
      const slot = (g) => data.group ? (g === "Other" ? "other" : String(data.kept.indexOf(g) + 1)) : "1";
      data.points.forEach(p => {
        const dot = svg("circle", { class: `da-point s-${slot(p.group)}`, cx: xs(p.x).toFixed(1), cy: ys(p.y).toFixed(1), r: 4 });
        dot.addEventListener("mousemove", (e) => show(e, [data.group ? p.group : `Row ${p.row + 2}`,
          `${data.x.name}: ${xLabel(p.x)}`, `${data.y.name}: ${fmt(p.y)}`]));
        dot.addEventListener("mouseleave", hide);
        plot.append(dot);
      });
      xAxisLabel(data.x.name);
    }

    // Legend (only when there are groups) and notes
    const legend = data.kind === "scatter" && data.group && el("ul", { class: "da-legend", "aria-label": `Colour: ${data.group.name}` },
      data.series.map(g => el("li", {}, el("span", { class: `da-swatch s-${g === "Other" ? "other" : data.kept.indexOf(g) + 1}`, "aria-hidden": "true" }), g)));
    const note = [
      data.kind === "bar" && data.hidden && `Showing the ${BAR_LIMIT} largest of ${fmtInt(data.hidden + data.bars.length)} groups.`,
      data.kind === "scatter" && data.total > data.points.length && `Drawing an even sample of ${fmtInt(data.points.length)} of ${fmtInt(data.total)} points (R draws them all).`,
      data.kind === "scatter" && data.group && data.series.includes("Other") && `Colours show the ${GROUP_LIMIT} biggest groups in the whole dataset; the rest are “Other”.`,
    ].filter(Boolean).join(" ");

    box.replaceChildren(...[el("p", { class: "da-chart-title" }, chartTitle(data)), legend, root, tip, note && el("p", { class: "media-muted" }, note)].filter(Boolean));
    return data;
  }

  function valueLabel(data) {
    const ch = S.meta.chart;
    if (ch.agg === "count" || !data.y) return "Rows";
    return `${{ sum: "Sum", mean: "Average", median: "Median" }[ch.agg]} of ${data.y.name}`;
  }
  function chartTitle(data) {
    if (data.kind === "histogram") return `Spread of ${data.x.name}`;
    if (data.kind === "scatter") return `${data.y.name} against ${data.x.name}${data.group ? `, by ${data.group.name}` : ""}`;
    return `${valueLabel(data)} by ${data.x.name}`;
  }
  function periodLabel(ms) {
    const p = S.meta.chart.period;
    const d = new Date(ms);
    if (p === "year") return String(d.getUTCFullYear());
    if (p === "month") return d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
    return (p === "week" ? "Week of " : "") + d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }

  /* The chart's numbers as a table (a text alternative to the picture) */
  function chartTable(data) {
    let head, rows;
    if (data.kind === "histogram") {
      head = [`${data.x.name} from`, "to", "Rows"];
      rows = data.bins.map(b => [timeLike(data.x) ? fmtDate(b.from) : fmt(b.from), timeLike(data.x) ? fmtDate(b.to) : fmt(b.to), fmtInt(b.count)]);
    } else if (data.kind === "bar") {
      head = [data.x.name, valueLabel(data)];
      rows = data.bars.map(b => [b.label, fmt(b.value)]);
    } else if (data.kind === "line") {
      head = [data.x.name, valueLabel(data)];
      rows = data.points.map(p => [timeLike(data.x) ? periodLabel(p.x) : fmt(p.x), fmt(p.y)]);
    } else {
      head = [data.x.name, data.y.name, ...(data.group ? [data.group.name] : [])];
      rows = data.points.slice(0, 500).map(p => [timeLike(data.x) ? fmtDate(p.x) : fmt(p.x), fmt(p.y), ...(data.group ? [p.group] : [])]);
    }
    return el("div", { class: "tracker-wrap" }, el("table", { class: "tracker-table da-rows" },
      el("caption", { class: "visually-hidden" }, chartTitle(data)),
      el("thead", {}, el("tr", {}, head.map(h => el("th", { scope: "col" }, h)))),
      el("tbody", {}, rows.map(r => el("tr", {}, r.map(v => el("td", {}, v)))))));
  }


  /* =========================================================
     R CODE (tidyverse + ggplot2)
     ========================================================= */

  // A column name R can use: plain names as-is, others in `backticks`
  const rName = (name) => /^[A-Za-z][A-Za-z0-9._]*$/.test(name) && !["if", "else", "for", "TRUE", "FALSE", "NA", "NULL", "function", "in"].includes(name)
    ? name : "`" + name.replace(/`/g, "\\`") + "`";
  const rString = (s) => JSON.stringify(String(s));

  function rFilter(rule) {
    const col = S.table.columns.find(c => c.name === rule.col);
    if (!col || !ruleTest(rule)) return null;
    const c = rName(col.name);
    const { op, value: a, value2: b } = rule;
    if (op === "missing") return `is.na(${c})`;
    if (op === "present") return `!is.na(${c})`;
    if (op === "true") return c;
    if (op === "false") return `!${c}`;
    if (col.type === "number") {
      if (op === "between") return `between(${c}, ${Math.min(a, b)}, ${Math.max(a, b)})`;
      return `${c} ${op === "=" ? "==" : op} ${Number(a)}`;
    }
    if (col.type === "date" || col.type === "datetime") {
      const d = col.type === "datetime" ? `as.Date(${c})` : c;
      const date = (x) => `as.Date(${rString(x)})`;
      if (op === "on") return `${d} == ${date(a)}`;
      if (op === "before") return `${d} < ${date(a)}`;
      if (op === "after") return `${d} > ${date(a)}`;
      const [lo, hi] = [a, b].sort();
      return `between(${d}, ${date(lo)}, ${date(hi)})`;
    }
    if (op === "is") return `${c} == ${rString(a)}`;
    if (op === "isnot") return `${c} != ${rString(a)}`;
    if (op === "contains") return `str_detect(${c}, fixed(${rString(a)}, ignore_case = TRUE))`;
    if (op === "notcontains") return `!str_detect(${c}, fixed(${rString(a)}, ignore_case = TRUE))`;
    return `${c} %in% c(${oneOf(a).map(rString).join(", ")})`;
  }

  /* ---------- Datawrapper (via its API, from R) ----------
     API v3: POST /charts (title, type) · PUT /charts/{id}/data (CSV)
     · PATCH /charts/{id} (metadata) · POST /charts/{id}/publish,
     with the token as a Bearer header. */
  const DW_TYPES = { histogram: "column-chart", bar: "d3-bars", line: "d3-lines", scatter: "d3-scatter-plot" };

  function datawrapperCode(data) {
    const ch = S.meta.chart;
    const x = rName(ch.x), y = ch.y ? rName(ch.y) : null;
    const summaryFn = { sum: "sum", mean: "mean", median: "median" }[ch.agg];
    const title = chartTitle(data);
    const lines = [`# Chart: ${title}, made in Datawrapper`, "", "# 1. The numbers the chart shows (the same as the preview on the page)"];

    if (data.kind === "histogram" && timeLike(data.x)) {
      // Dates: rows per period (cut() would label date bins in row order, not date order)
      lines.push(`# Rows per ${ch.period} (the preview on the page splits the dates into ${ch.bins} equal bins)`,
        "chart_data <- filtered |>",
        `  filter(!is.na(${x})) |>`,
        `  count(period = floor_date(${x}, ${rString(ch.period)}${ch.period === "week" ? ", week_start = 1" : ""}), name = "Rows") |>`,
        "  arrange(period) |>",
        `  rename(${rName(data.x.name)} = period)`);
    } else if (data.kind === "histogram") {
      lines.push("chart_data <- filtered |>",
        `  filter(!is.na(${x})) |>`,
        `  mutate(range = cut(${x}, breaks = ${ch.bins}, include.lowest = TRUE, dig.lab = 6)) |>`,
        "  count(range, name = \"Rows\", .drop = FALSE) |>",
        "  mutate(range = as.character(range))");
    }
    if (data.kind === "bar") {
      lines.push("chart_data <- filtered |>",
        ch.agg === "count"
          ? `  count(${x}, name = "value") |>`
          : `  group_by(${x}) |>\n  summarise(value = ${summaryFn}(${y}, na.rm = TRUE)) |>`,
        `  slice_max(value, n = ${BAR_LIMIT}) |>`,
        `  mutate(${x} = as.character(${x})) |>`,
        `  rename(${rName(valueLabel(data))} = value)`);
    }
    if (data.kind === "line") {
      const time = timeLike(data.x);
      const period = time ? `floor_date(${x}, ${rString(ch.period)}${ch.period === "week" ? ", week_start = 1" : ""})` : x;
      lines.push("chart_data <- filtered |>",
        `  filter(!is.na(${x})) |>`,
        `  mutate(period = ${period}) |>`,
        ch.agg === "count"
          ? "  count(period, name = \"value\") |>"
          : `  group_by(period) |>\n  summarise(value = ${summaryFn}(${y}, na.rm = TRUE)) |>`,
        "  arrange(period) |>",
        `  rename(${rName(data.x.name)} = period, ${rName(valueLabel(data))} = value)`);
    }
    if (data.kind === "scatter") {
      const g = data.group ? rName(data.group.name) : null;
      lines.push("chart_data <- filtered |>",
        `  select(${[x, y, g].filter(Boolean).join(", ")}) |>`,
        `  filter(!is.na(${x}), !is.na(${y}))`);
      if (g) lines.push(`# To colour the dots by ${data.group.name}, pick that column in Datawrapper under Refine › Color.`);
    }

    const source = S.meta.name;
    lines.push("",
      "# 2. Send it to Datawrapper",
      "library(httr2)",
      "",
      "# Your Datawrapper API token. Make one at https://app.datawrapper.de/account/api-tokens",
      "# with chart:read and chart:write (add theme:read and visualization:read to publish).",
      "# Save it once by running usethis::edit_r_environ(), adding the line",
      "#   DATAWRAPPER_API_KEY=your-token",
      "# and restarting R. (Keep the token out of this script.)",
      "token <- Sys.getenv(\"DATAWRAPPER_API_KEY\")",
      "if (token == \"\") stop(\"Set DATAWRAPPER_API_KEY first (see the comment above).\")",
      "",
      "`%||%` <- function(a, b) if (is.null(a)) b else a",
      "dw <- function(path, method = \"GET\") {",
      "  request(\"https://api.datawrapper.de/v3\") |>",
      "    req_url_path_append(path) |>",
      "    req_auth_bearer_token(token) |>",
      "    req_method(method)",
      "}",
      "",
      "# Create the chart",
      "chart <- dw(\"charts\", \"POST\") |>",
      `  req_body_json(list(title = ${rString(title)}, type = ${rString(DW_TYPES[data.kind])})) |>`,
      "  req_perform() |>",
      "  resp_body_json()",
      "",
      "# Upload the data",
      "dw(paste0(\"charts/\", chart$id, \"/data\"), \"PUT\") |>",
      "  req_body_raw(format_csv(chart_data), type = \"text/csv\") |>",
      "  req_perform()",
      "",
      "# Add the source line",
      "dw(paste0(\"charts/\", chart$id), \"PATCH\") |>",
      `  req_body_json(list(metadata = list(describe = list("source-name" = ${rString(source)})))) |>`,
      "  req_perform()",
      "",
      "# Publish (skip this to keep it as a draft)",
      "published <- dw(paste0(\"charts/\", chart$id, \"/publish\"), \"POST\") |>",
      "  req_perform() |>",
      "  resp_body_json()",
      "",
      "public_url <- published$data$publicUrl %||% published$publicUrl %||%",
      "  paste0(\"https://datawrapper.dwcdn.net/\", chart$id, \"/\")",
      "message(\"Edit it:     https://app.datawrapper.de/chart/\", chart$id, \"/visualize\")",
      "message(\"Public link: \", public_url)");
    return lines;
  }

  function rCode(data) {
    const ch = S.meta.chart;
    const file = S.meta.name;
    const lines = [
      `# ${file}: profile, filter and chart`,
      `# Written by The Cobbler Project (${new Date().toISOString().slice(0, 10)}). Run it in RStudio.`,
      "",
      "library(tidyverse)",
      "",
      ...(S.meta.sheet != null
        ? ["# Load the data (save this script in the same folder as the Excel file, or change the path)",
           "library(readxl)",
           `data <- read_excel(${rString(file)}, sheet = ${rString(S.meta.sheet)})`]
        : ["# Load the data (save this script in the same folder as the CSV, or change the path)",
           `data <- read_csv(${rString(file)})`]),
      "",
      "# Profile: each column's type, a preview, and summary statistics",
      "glimpse(data)",
      "summary(data)",
      "",
    ];

    const rules = S.meta.filters.map(rFilter).filter(Boolean);
    if (rules.length) {
      lines.push("# Filter", "filtered <- data |>", "  filter(", rules.map(r => `    ${r}`).join(",\n"), "  )", "");
    } else {
      lines.push("# No filters", "filtered <- data", "");
    }
    lines.push(`nrow(filtered)  # ${fmtInt(S.rows.length)} rows on the page`, "");

    if (!data) return lines.join("\n");
    if (ch.tool === "datawrapper") return lines.concat(datawrapperCode(data)).join("\n") + "\n";
    const x = rName(ch.x), y = ch.y ? rName(ch.y) : null;
    const theme = "  theme_minimal()";
    const summaryFn = { sum: "sum", mean: "mean", median: "median" }[ch.agg];
    lines.push(`# Chart: ${chartTitle(data)}`);

    if (data.kind === "histogram") {
      lines.push(`ggplot(filtered, aes(x = ${x})) +`,
        `  geom_histogram(bins = ${ch.bins}, fill = "#2a78d6") +`,
        `  labs(title = ${rString(chartTitle(data))}, x = ${rString(data.x.name)}, y = "Rows") +`, theme);
    }
    if (data.kind === "bar") {
      const value = ch.agg === "count" ? "n" : "value";
      lines.push("filtered |>",
        ch.agg === "count"
          ? `  count(${x}) |>`
          : `  group_by(${x}) |>\n  summarise(value = ${summaryFn}(${y}, na.rm = TRUE)) |>`,
        `  slice_max(${value}, n = ${BAR_LIMIT}) |>`,
        `  ggplot(aes(x = reorder(as.character(${x}), -${value}), y = ${value})) +`,
        `  geom_col(fill = "#2a78d6") +`,
        `  labs(title = ${rString(chartTitle(data))}, x = ${rString(data.x.name)}, y = ${rString(valueLabel(data))}) +`,
        ...(ch.horizontal
          ? ["  coord_flip() +", theme]
          : [theme + " +", "  theme(axis.text.x = element_text(angle = 35, hjust = 1))"]));
    }
    if (data.kind === "line") {
      const time = timeLike(data.x);
      const period = time ? `floor_date(${x}, ${rString(ch.period === "week" ? "week" : ch.period)}${ch.period === "week" ? ", week_start = 1" : ""})` : x;
      lines.push("filtered |>",
        `  filter(!is.na(${x})) |>`,
        `  mutate(period = ${period}) |>`,
        ch.agg === "count"
          ? "  count(period, name = \"value\") |>"
          : `  group_by(period) |>\n  summarise(value = ${summaryFn}(${y}, na.rm = TRUE)) |>`,
        "  ggplot(aes(x = period, y = value)) +",
        `  geom_line(colour = "#2a78d6", linewidth = 1) +`,
        `  labs(title = ${rString(chartTitle(data))}, x = ${rString(data.x.name)}, y = ${rString(valueLabel(data))}) +`, theme);
    }
    if (data.kind === "scatter") {
      if (data.group) {
        const g = rName(data.group.name);
        const colours = ["#2a78d6", "#eb6834", "#1baf7a"];
        const values = [...data.kept.map((s, i) => `${rString(s)} = ${rString(colours[i])}`), `"Other" = "#9a9a9a"`].join(", ");
        lines.push("# The coloured groups are the biggest in the whole dataset, so colours don't change when you filter",
          `coloured <- c(${data.kept.map(rString).join(", ")})`,
          "filtered |>",
          `  mutate(group = replace_na(as.character(${g}), "(missing)"),`,
          `         group = if_else(group %in% coloured, group, "Other")) |>`,
          `  ggplot(aes(x = ${x}, y = ${y}, colour = group)) +`,
          "  geom_point(alpha = 0.7) +",
          `  scale_colour_manual(values = c(${values})) +`,
          `  labs(title = ${rString(chartTitle(data))}, x = ${rString(data.x.name)}, y = ${rString(data.y.name)}, colour = ${rString(data.group.name)}) +`, theme);
      } else {
        lines.push(`ggplot(filtered, aes(x = ${x}, y = ${y})) +`,
          `  geom_point(colour = "#2a78d6", alpha = 0.7) +`,
          `  labs(title = ${rString(chartTitle(data))}, x = ${rString(data.x.name)}, y = ${rString(data.y.name)}) +`, theme);
      }
    }
    lines.push("", "# Save the chart next to the script", `ggsave(${rString(file.replace(/\.[^.]+$/, "") + "-chart.png")}, width = 8, height = 5, dpi = 200)`);
    return lines.join("\n") + "\n";
  }


  /* =========================================================
     THE PAGE
     ========================================================= */

  const S = { meta: null, table: null, rows: [] };
  let datasets = Projects.getData("datasets", []);
  if (!Array.isArray(datasets)) datasets = [];
  const saveDatasets = () => Projects.setData("datasets", datasets.filter(d => !d.unsaved));

  /* Redraws after a change. Settings are saved with the dataset. */
  function changed({ filters = false, filtersQuiet = false, chart = false } = {}) {
    if (filters) renderFilters();
    if (filters || filtersQuiet) S.rows = filteredRows();
    if (filtersQuiet) renderFilters();
    if (chart || filters || filtersQuiet) { fixChart(); renderChartControls(); }
    $("da-count").textContent = `${fmtInt(S.rows.length)} of ${fmtInt(S.table.rowCount)} rows`;
    const data = renderChart(S.rows);
    $("da-code").textContent = rCode(data);
    $("da-tool-note").hidden = S.meta.chart.tool !== "datawrapper";
    renderRows();
    saveDatasets();
  }

  /* The rows, a page at a time */
  const paging = { page: 1, size: 25 };
  let renderingRows = false;   // (replacing the pager while its own input has focus fires a second change)
  function renderRows() {
    if (renderingRows) return;
    renderingRows = true;
    try { drawRows(); } finally { renderingRows = false; }
  }
  function drawRows() {
    const cols = S.table.columns;
    const total = S.rows.length;
    const pages = Math.max(1, Math.ceil(total / paging.size));
    paging.page = Math.min(pages, Math.max(1, paging.page));
    const from = (paging.page - 1) * paging.size;
    const shown = S.rows.slice(from, from + paging.size);
    $("da-rows-note").textContent = total ? `Rows ${fmtInt(from + 1)}–${fmtInt(from + shown.length)} of ${fmtInt(total)}` : "No rows match";
    const pageInput = el("input", { type: "number", min: "1", max: String(pages), value: String(paging.page), class: "te-seconds", "aria-label": "Page number" });
    pageInput.addEventListener("change", () => { paging.page = Number(pageInput.value) || 1; renderRows(); });
    const sizeSelect = el("select", { class: "team-select", "aria-label": "Rows per page" }, [10, 25, 50, 100, 250].map(n => el("option", { value: String(n), selected: paging.size === n }, `${n} per page`)));
    sizeSelect.addEventListener("change", () => { paging.size = Number(sizeSelect.value); paging.page = 1; renderRows(); });
    $("da-rows-pager").replaceChildren(
      el("button", { type: "button", class: "small-btn", disabled: paging.page <= 1, "aria-label": "First page", onclick: () => { paging.page = 1; renderRows(); } }, "«"),
      el("button", { type: "button", class: "small-btn", disabled: paging.page <= 1, "aria-label": "Previous page", onclick: () => { paging.page--; renderRows(); } }, "‹"),
      el("label", { class: "tool-group" }, "Page ", pageInput, ` of ${fmtInt(pages)}`),
      el("button", { type: "button", class: "small-btn", disabled: paging.page >= pages, "aria-label": "Next page", onclick: () => { paging.page++; renderRows(); } }, "›"),
      el("button", { type: "button", class: "small-btn", disabled: paging.page >= pages, "aria-label": "Last page", onclick: () => { paging.page = pages; renderRows(); } }, "»"),
      sizeSelect);
    $("da-rows").replaceChildren(
      el("thead", {}, el("tr", {}, cols.map(c => el("th", { scope: "col", class: c.type === "number" ? "is-num" : null }, c.name)))),
      el("tbody", {}, shown.map(r => el("tr", {}, cols.map(c => {
        const raw = S.table.body[r][c.index] ?? "";
        return el("td", { class: [c.type === "number" && "is-num", isMissing(raw) && "is-missing"].filter(Boolean).join(" ") || null },
          isMissing(raw) ? "NA" : raw);
      })))));
  }

  function renderPicker() {
    const pick = $("da-pick");
    pick.replaceChildren(...datasets.map(d => el("option", { value: d.id }, d.sheet != null ? `${d.name} › ${d.sheet}` : d.name)));
    $("da-pick-wrap").hidden = !datasets.length;
    $("da-remove").hidden = !S.meta;
    if (S.meta) pick.value = S.meta.id;
    renderSheetPicker();
  }

  /* For an Excel dataset whose workbook is kept: a Sheet drop-down to show another sheet */
  async function renderSheetPicker() {
    const wrap = $("da-sheet-wrap");
    const select = $("da-sheet-pick");
    wrap.hidden = true;
    if (!S.meta?.workbook) return;
    const file = await FileStore.get(S.meta.workbook).catch(() => null);
    if (!file || S.meta.workbook !== S.meta?.workbook) return;
    let sheets;
    try { sheets = await XlsxRead.read(file); } catch { return; }
    if (sheets.length < 2) return;
    select.replaceChildren(...sheets.map(s => el("option", { value: s.name, selected: s.name === S.meta.sheet }, `${s.name} (${fmtInt(Math.max(0, s.rows.length - 1))} rows)`)));
    select.onchange = async () => {
      const chosen = sheets.find(s => s.name === select.value);
      if (!chosen || !S.meta) return;
      const text = XlsxRead.toCSV(chosen.rows);
      try { buildTable(text); } catch (err) { setStatus(`Couldn't read sheet ${chosen.name}: ${err.message}.`); select.value = S.meta.sheet; return; }
      S.meta.sheet = chosen.name;
      S.meta.filters = [];   // the columns are different now
      S.meta.chart = {};
      try { await FileStore.put(S.meta.blob, new Blob([text], { type: "text/csv" })); } catch {}
      saveDatasets();
      await openDataset(S.meta, text);
    };
    wrap.hidden = false;
  }

  /* Opens a dataset: reads its CSV and draws everything */
  async function openDataset(meta, text = null) {
    try {
      if (text == null) {
        const blob = await FileStore.get(meta.blob);
        if (!blob) throw new Error("its CSV isn't stored in this browser any more. Load the file again");
        text = await blob.text();
      }
      S.table = buildTable(text);
    } catch (err) {
      setStatus(`Couldn't open ${meta.name}: ${err.message}.`);
      return;
    }
    S.meta = meta;
    meta.filters ||= [];
    meta.chart ||= {};
    try { localStorage.setItem(currentKey(), meta.id); } catch {}

    $("da-work").hidden = false;
    $("da-file-name").textContent = meta.name;
    $("da-summary").textContent = `${fmtInt(S.table.rowCount)} rows · ${S.table.columns.length} columns`;
    renderPicker();
    renderProfile();
    renderFilters();
    S.rows = filteredRows();
    fixChart();
    renderChartControls();
    changed();
  }

  /* Which sheet of a workbook? (asked only when there's more than one with something in it) */
  function pickSheet(sheets) {
    const usable = sheets.filter(s => s.rows.length > 1);
    if (usable.length <= 1) return Promise.resolve(usable[0] || sheets[0]);
    return new Promise(resolve => {
      const dialog = $("da-sheet");
      const list = $("da-sheet-list");
      list.replaceChildren(...usable.map(s => el("li", {},
        el("button", { type: "button", class: "small-btn", onclick: () => { dialog.close(); resolve(s); } },
          `${s.name} (${fmtInt(s.rows.length - 1)} rows, ${s.rows[0].length} columns)`))));
      dialog.addEventListener("close", () => resolve(null), { once: true });
      dialog.showModal();
    });
  }

  async function loadFile(file) {
    let text, sheet = null, workbook = null;
    if (window.XlsxRead?.isExcel(file.name)) {
      let sheets;
      try { sheets = await XlsxRead.read(file); } catch (err) { setStatus(`Couldn't read ${file.name}: ${err.message}.`); return; }
      const chosen = await pickSheet(sheets);
      if (!chosen) return;
      sheet = chosen.name;
      text = XlsxRead.toCSV(chosen.rows);
      workbook = newId();   // the workbook is kept too, so the sheet can be changed later
    } else {
      text = await file.text();
    }
    try { buildTable(text); } catch (err) { setStatus(`Couldn't read ${file.name}: ${err.message}.`); return; }
    const meta = { id: newId(), name: file.name, blob: newId(), size: file.size, added: Date.now(), filters: [], chart: {}, ...(sheet != null ? { sheet, workbook } : {}) };
    try {
      await FileStore.put(meta.blob, new Blob([text], { type: "text/csv" }));
      if (workbook) await FileStore.put(workbook, file);
    } catch {
      meta.unsaved = true;
      setStatus("This browser can't store files here, so the data will be gone after you reload. Try opening the site from a local server.");
    }
    datasets.push(meta);
    saveDatasets();
    await openDataset(meta, text);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("da-load").addEventListener("click", () => $("da-input").click());
    $("da-input").addEventListener("change", (event) => {
      if (event.target.files[0]) loadFile(event.target.files[0]);
      event.target.value = "";
    });
    $("da-pick").addEventListener("change", (event) => openDataset(datasets.find(d => d.id === event.target.value)));
    $("da-remove").addEventListener("click", async () => {
      if (!S.meta || !confirm(`Remove “${S.meta.name}” from this project? Your copy of the CSV file isn't touched.`)) return;
      const gone = S.meta;
      datasets = datasets.filter(d => d !== gone);
      saveDatasets();
      FileStore.remove(gone.blob).catch(() => {});
      if (gone.workbook) FileStore.remove(gone.workbook).catch(() => {});
      S.meta = null;
      $("da-work").hidden = true;
      $("da-summary").textContent = "";
      renderPicker();
      if (datasets[0]) openDataset(datasets[0]);
    });
    $("da-add-filter").addEventListener("click", () => {
      const col = S.table.columns[0];
      S.meta.filters.push({ col: col.name, op: opsFor(col)[0][0], value: "", value2: "" });
      changed({ filters: true });
    });
    if (window.DocExport) $("da-remove").after(DocExport.buttons({ blocks: () => {
      if (!S.table) return [];
      const cols = S.table.columns;
      const stat = (p, k) => p[k] == null ? "" : typeof p[k] === "number" && !Number.isInteger(p[k]) ? fmt(p[k]) : String(p[k]);
      const profile = cols.map(c => { const p = profileOf(c); return [c.name, c.type, fmtInt(p.missing), fmtInt(p.unique), c.type === "number" ? `${stat(p, "min")} – ${stat(p, "max")}, mean ${stat(p, "mean")}, median ${stat(p, "median")}` : (c.type === "date" || c.type === "datetime") ? `${fmtDate(p.min)} – ${fmtDate(p.max)}` : (p.top || []).map(([v, n]) => `${v} (${n})`).join(", ")]; });
      const rows = S.rows.slice(0, 500);
      return [
        { t: "title", text: S.meta.sheet != null ? `${S.meta.name} › ${S.meta.sheet}` : S.meta.name },
        { t: "meta", text: `${fmtInt(S.table.rowCount)} rows · ${cols.length} columns · ${fmtInt(S.rows.length)} rows after filters · ${new Date().toLocaleDateString()}` },
        { t: "h2", text: "Columns" },
        { t: "table", head: ["Column", "Type", "Missing", "Unique", "Summary"], rows: profile },
        ...(S.meta.filters.length ? [{ t: "h2", text: "Filters" }, { t: "list", items: S.meta.filters.map(f => rFilter(f) || JSON.stringify(f)).filter(Boolean) }] : []),
        { t: "h2", text: `Rows${S.rows.length > 500 ? " (first 500 after filters)" : ""}` },
        { t: "table", head: cols.map(c => c.name), rows: rows.map(r => cols.map(c => { const raw = S.table.body[r][c.index] ?? ""; return isMissing(raw) ? "NA" : String(raw); })) },
      ];
    }, title: `Data: ${S.meta?.name || ""}`, filename: `${Cobbler.slug(S.meta?.name || "data")}-profile`, label: "Document" }));
    $("da-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("da-code").textContent); setStatus("R code copied."); }
      catch { setStatus("Couldn't copy. Select the code and copy it instead."); }
    });
    $("da-save-r").addEventListener("click", () =>
      download($("da-code").textContent, `${S.meta.name.replace(/\.[^.]+$/, "")}-analysis.R`, "text/plain"));

    // Redraw the chart at the new width when the window changes size
    let resizeTimer = 0;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (S.meta) renderChart(S.rows); }, 200);
    });

    renderPicker();
    let last = null;
    try { last = localStorage.getItem(currentKey()); } catch {}
    const start = datasets.find(d => d.id === last) || datasets[0];
    if (start) openDataset(start);
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    event.detail.handled = true;
    datasets = Projects.getData("datasets", []);
    if (!Array.isArray(datasets)) datasets = [];
    const meta = S.meta && datasets.find(d => d.id === S.meta.id);
    if (meta) { openDataset(meta); return; }
    S.meta = null;
    $("da-work").hidden = true;
    $("da-summary").textContent = "";
    renderPicker();
    if (datasets[0]) openDataset(datasets[0]);
  });

  window.DataAnalysis = { buildTable, rCode: () => $("da-code").textContent };
})();
