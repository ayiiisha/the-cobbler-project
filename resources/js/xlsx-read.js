/* =========================================================
   xlsx-read.js — reads Excel workbooks (.xlsx) in the browser
   ---------------------------------------------------------
   An .xlsx file is a ZIP of XML files. This reads just enough of
   it to get each sheet's cells as text, the way they'd come out
   of "Save as CSV": numbers as typed, dates as 2024-01-05 (or
   2024-01-05 10:30), TRUE/FALSE, and formulas by their last
   calculated value. No library needed: the browser unzips with
   DecompressionStream (Chrome 103+, Safari 16.4+, Firefox 113+).

     const sheets = await XlsxRead.read(file);
       → [{ name: "Sheet1", rows: [["Name", "Age"], ["Ana", "34"], …] }, …]
     XlsxRead.toCSV(rows)   → CSV text (what the Data Analysis page reads)

   Not handled: .xls (the old binary format), password-protected
   files, and sheets with more than a million cells (slow).
   ========================================================= */
(() => {

  /* =========================================================
     1. UNZIP: find each file in the ZIP's central directory and inflate it
     ========================================================= */

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    // The end-of-central-directory record is at the end (after an optional comment)
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("this isn't a ZIP file (so not an .xlsx)");
    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(at, true) !== 0x02014b50) break;
      const method = view.getUint16(at + 10, true);
      const compressed = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const headerAt = view.getUint32(at + 42, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      entries.set(name, { method, compressed, headerAt });
      at += 46 + nameLength + extraLength + commentLength;
    }

    async function file(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      // The local header repeats the name and extra fields; the data follows them
      const h = entry.headerAt;
      const dataAt = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
      const data = bytes.subarray(dataAt, dataAt + entry.compressed);
      if (entry.method === 0) return decoder.decode(data);
      if (entry.method !== 8) throw new Error("the file is compressed in a way this can't read");
      if (typeof DecompressionStream !== "function") throw new Error("this browser can't unzip files (needs Chrome 103, Safari 16.4 or Firefox 113 or newer)");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    }
    return { names: [...entries.keys()], file };
  }


  /* =========================================================
     2. XML bits (the sheets are simple enough for DOMParser)
     ========================================================= */

  const parse = (xml) => new DOMParser().parseFromString(xml, "application/xml");
  const unescape = (text) => text;   // DOMParser has already unescaped &amp; etc.

  // A cell's text: <t> pieces joined (rich text has several <r><t>…</t></r>)
  const textOf = (node) => [...node.getElementsByTagName("t")].map(t => t.textContent).join("");

  // "AB12" → column 27 (0-based: 27), row 12
  function ref(cellRef) {
    const m = /^([A-Z]+)(\d+)$/.exec(cellRef);
    if (!m) return null;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col: col - 1, row: Number(m[2]) - 1 };
  }


  /* =========================================================
     3. DATES: a cell is a date when its number format says so
     ========================================================= */

  // Excel's built-in date formats (ids 14–22 and 45–47); custom ones are read from styles.xml
  const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const looksLikeDate = (code) => /[dmyhs]/i.test(code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "")) && !/[#0]/.test(code.replace(/"[^"]*"/g, ""));
  const hasTime = (code) => /[hs]|AM\/PM/i.test(code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, ""));

  function dateStyles(stylesXML) {
    const out = new Map();   // style index → "date" | "datetime"
    if (!stylesXML) return out;
    const doc = parse(stylesXML);
    const custom = new Map();
    for (const f of doc.getElementsByTagName("numFmt")) custom.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") || "");
    const xfs = doc.getElementsByTagName("cellXfs")[0];
    if (!xfs) return out;
    [...xfs.getElementsByTagName("xf")].forEach((xf, i) => {
      const id = Number(xf.getAttribute("numFmtId") || 0);
      const code = custom.get(id);
      if (BUILTIN_DATES.has(id)) out.set(i, id === 22 ? "datetime" : [18, 19, 20, 21, 45, 46, 47].includes(id) ? "time" : "date");
      else if (code && looksLikeDate(code)) out.set(i, hasTime(code) ? (/[dmy]/i.test(code.replace(/\[[^\]]*\]/g, "")) ? "datetime" : "time") : "date");
    });
    return out;
  }

  // Excel keeps dates as days since 1899-12-30 (with the 1900 leap-year quirk built in)
  const pad = (n) => String(n).padStart(2, "0");
  function excelDate(serial, kind, date1904) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(serial * 86400000);
    const d = new Date(ms);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${d.getUTCSeconds() ? `:${pad(d.getUTCSeconds())}` : ""}`;
    if (kind === "time") return time;
    if (kind === "datetime") return `${day} ${time}`;
    return day;
  }


  /* =========================================================
     4. THE WORKBOOK: sheet names, shared strings, then each sheet's cells
     ========================================================= */

  async function read(file) {
    const zip = await unzip(await file.arrayBuffer());
    const workbookXML = await zip.file("xl/workbook.xml");
    if (!workbookXML) throw new Error("no workbook inside: is this an .xlsx file?");
    const workbook = parse(workbookXML);
    const date1904 = /true|1/i.test(workbook.getElementsByTagName("workbookPr")[0]?.getAttribute("date1904") || "");

    // Which file holds each sheet (xl/_rels/workbook.xml.rels maps r:id → worksheets/sheet1.xml)
    const rels = new Map();
    const relsXML = await zip.file("xl/_rels/workbook.xml.rels");
    if (relsXML) for (const r of parse(relsXML).getElementsByTagName("Relationship")) rels.set(r.getAttribute("Id"), r.getAttribute("Target"));

    // Shared strings: cells with t="s" hold an index into this list
    const shared = [];
    const sharedXML = await zip.file("xl/sharedStrings.xml");
    if (sharedXML) for (const si of parse(sharedXML).getElementsByTagName("si")) shared.push(textOf(si));

    const styles = dateStyles(await zip.file("xl/styles.xml"));

    const sheets = [];
    for (const sheet of workbook.getElementsByTagName("sheet")) {
      const name = sheet.getAttribute("name") || `Sheet ${sheets.length + 1}`;
      if (sheet.getAttribute("state") && sheet.getAttribute("state") !== "visible") continue;   // hidden sheets
      const rid = sheet.getAttribute("r:id") || [...sheet.attributes].find(a => a.localName === "id")?.value;
      let target = rels.get(rid) || `worksheets/sheet${sheets.length + 1}.xml`;
      target = target.replace(/^\/?(xl\/)?/, "xl/");
      const xml = await zip.file(target);
      if (!xml) continue;
      sheets.push({ name, rows: cells(parse(xml), shared, styles, date1904) });
    }
    if (!sheets.length) throw new Error("the workbook has no sheets that can be read");
    return sheets;
  }

  function cells(doc, shared, styles, date1904) {
    const grid = [];
    let maxCol = 0;
    for (const c of doc.getElementsByTagName("c")) {
      const where = ref(c.getAttribute("r") || "");
      if (!where) continue;
      const type = c.getAttribute("t") || "";
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(c);
      else if (type === "str") value = v;                         // a formula's text result
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (type === "e") value = "";                          // #DIV/0! and friends count as missing
      else if (v === "") value = "";
      else {
        const kind = styles.get(Number(c.getAttribute("s") || -1));
        const n = Number(v);
        value = kind && Number.isFinite(n) ? excelDate(n, kind, date1904) : v;
      }
      (grid[where.row] ??= [])[where.col] = unescape(value);
      if (where.col + 1 > maxCol) maxCol = where.col + 1;
    }
    // Fill the gaps so every row has every column, and drop empty rows
    return grid
      .map(row => Array.from({ length: maxCol }, (_, i) => row?.[i] ?? ""))
      .filter(row => row.some(cell => String(cell).trim() !== ""));
  }


  /* =========================================================
     5. CSV, for pages that already read CSV
     ========================================================= */

  const csvField = (value) => {
    const v = String(value ?? "");
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const toCSV = (rows) => rows.map(row => row.map(csvField).join(",")).join("\r\n");

  const isExcel = (name) => /\.(xlsx|xlsm)$/i.test(name || "");

  window.XlsxRead = { read, toCSV, isExcel };
})();
