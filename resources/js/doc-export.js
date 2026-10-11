/* =========================================================
   doc-export.js — documents as PDF (print) or Word (.docx)
   ---------------------------------------------------------
   Pages describe a document as a list of blocks, and this file
   turns it into either:
     • a PDF, through the browser's print window ("Save as PDF")
     • a Word document (.docx), built right here in the browser

   Blocks:
     { t: "title", text }            the document's title
     { t: "meta", text }             a small grey line (dates, details)
     { t: "h1", text } { t: "h2", text }
     { t: "p", text }                a paragraph (new lines kept)
     { t: "list", items: [text] }    bullet points
     { t: "checks", items: [text or { text, done }] }   tick boxes ☐ / ☑
     { t: "fields", items: [[label, value], ...] }      label: value lines
     { t: "table", head: [..], rows: [[..], ..] }

     DocExport.print(blocks, { title, spacing: "double", font })
     DocExport.downloadDocx(blocks, { title, filename })
     DocExport.buttons({ blocks: () => [...], title, filename, label })
       → a <span> with "PDF" and "Word" buttons (blocks is called
         when one is clicked, so it always exports what's on screen)

   Needs zip.js (for .docx).
   ========================================================= */
(() => {

  const textOf = (v) => v == null ? "" : String(v);
  const checkItem = (item) => typeof item === "string" ? { text: item, done: false } : { text: textOf(item.text), done: !!item.done };


  /* =========================================================
     PDF: an HTML version of the document, printed
     ========================================================= */

  function el(tag, cls, ...children) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    node.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  // Keeps line breaks inside a piece of text
  const withBreaks = (text) => textOf(text).split("\n").flatMap((line, i) => i ? [document.createElement("br"), line] : [line]);

  function toHTML(blocks) {
    return blocks.map(b => {
      switch (b.t) {
        case "title": return el("h1", "doc-title", withBreaks(b.text));
        case "meta":  return el("p", "doc-meta", withBreaks(b.text));
        case "h1":    return el("h2", "doc-h1", withBreaks(b.text));
        case "h2":    return el("h3", "doc-h2", withBreaks(b.text));
        case "p":     return el("p", "doc-p", withBreaks(b.text));
        case "list":  return el("ul", "doc-list", b.items.map(i => el("li", null, withBreaks(i))));
        case "checks":
          return el("ul", "doc-checks", b.items.map(checkItem).map(i =>
            el("li", i.done ? "is-done" : null, el("span", "doc-box", i.done ? "☑" : "☐"), el("span", null, withBreaks(i.text)))));
        case "fields":
          return el("dl", "doc-fields", b.items.flatMap(([k, v]) => [el("dt", null, k), el("dd", null, withBreaks(v))]));
        case "table":
          return el("table", "doc-table",
            el("thead", null, el("tr", null, b.head.map(h => el("th", null, h)))),
            el("tbody", null, b.rows.map(r => el("tr", null, r.map(c => el("td", null, withBreaks(c)))))));
        default: return null;
      }
    });
  }

  /* Fills a print sheet with the document and opens the print window.
     The document title becomes the suggested PDF file name. */
  function print(blocks, { title = "Document", spacing = "single", font = null } = {}) {
    let sheet = document.getElementById("doc-print");
    if (!sheet) {
      sheet = el("div", "print-sheet doc-print");
      sheet.id = "doc-print";
      sheet.setAttribute("aria-hidden", "true");
      (document.querySelector("main") || document.body).append(sheet);
      window.addEventListener("afterprint", () => sheet.replaceChildren());
    }
    sheet.classList.toggle("is-double", spacing === "double");
    sheet.style.fontFamily = font || "";
    sheet.replaceChildren(...toHTML(blocks).filter(Boolean));

    const pageTitle = document.title;
    document.title = title;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.print();
      document.title = pageTitle;
    }));
  }


  /* =========================================================
     WORD (.docx): the same document as WordprocessingML
     ========================================================= */

  const xml = (text) => textOf(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  // A run of text, with new lines as Word line breaks
  const runs = (text, { bold = false, size = null, color = null } = {}) => {
    const props = [bold && "<w:b/>", color && `<w:color w:val="${color}"/>`, size && `<w:sz w:val="${size}"/>`].filter(Boolean).join("");
    const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
    return textOf(text).split("\n").map((line, i) =>
      `<w:r>${rPr}${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join("");
  };

  const para = (content, { style = null, indent = null, hanging = null, keepNext = false } = {}) => {
    const pPr = [
      style && `<w:pStyle w:val="${style}"/>`,
      keepNext && "<w:keepNext/>",
      indent != null && `<w:ind w:left="${indent}"${hanging ? ` w:hanging="${hanging}"` : ""}/>`,
    ].filter(Boolean).join("");
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${content}</w:p>`;
  };

  function table(head, rows) {
    const cell = (text, header) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(runs(text, { bold: header }))}</w:tc>`;
    const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>` +
      `<w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map(h => cell(h, true)).join("")}</w:tr>` +
      rows.map(r => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${head.map((_, i) => cell(r[i] ?? "", false)).join("")}</w:tr>`).join("") +
      `</w:tbl>${para("")}`;
  }

  function bodyXml(blocks) {
    return blocks.map(b => {
      switch (b.t) {
        case "title": return para(runs(b.text), { style: "Title" });
        case "meta":  return para(runs(b.text, { color: "666666", size: 20 }));
        case "h1":    return para(runs(b.text), { style: "Heading1", keepNext: true });
        case "h2":    return para(runs(b.text), { style: "Heading2", keepNext: true });
        case "p":     return para(runs(b.text));
        case "list":  return b.items.map(i => para(runs(`•\u00A0\u00A0${textOf(i)}`), { indent: 240, hanging: 240 })).join("");
        case "checks":
          return b.items.map(checkItem).map(i => para(runs(`${i.done ? "☑" : "☐"}\u00A0\u00A0${i.text}`), { indent: 300, hanging: 300 })).join("");
        case "fields":
          return b.items.map(([k, v]) => para(runs(`${k}: `, { bold: true }) + runs(v))).join("");
        case "table": return table(b.head, b.rows);
        default: return "";
      }
    }).join("");
  }

  function stylesXml(spacing) {
    const line = spacing === "double" ? 480 : 276;   // 240 = single line
    const heading = (id, name, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/>${id === "Heading1" ? '<w:outlineLvl w:val="0"/>' : id === "Heading2" ? '<w:outlineLvl w:val="1"/>' : ""}</w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${heading("Title", "Title", 44, 0)}
${heading("Heading1", "heading 1", 32, 360)}
${heading("Heading2", "heading 2", 26, 240)}
</w:styles>`;
  }

  function docxBlob(blocks, { title = "Document", spacing = "single" } = {}) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>` },
      { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
      { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title><dc:creator>The Cobbler Project</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>` },
      { name: "word/styles.xml", data: stylesXml(spacing) },
      { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${bodyXml(blocks)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body>
</w:document>` },
    ];
    return Zip.create(files);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadDocx(blocks, { title = "Document", filename = "document.docx", spacing } = {}) {
    download(new Blob([docxBlob(blocks, { title, spacing })], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), filename);
  }

    /* ---------- Two buttons: the same document as PDF or Word ---------- */
  function buttons({ blocks, title = "Document", filename = "document", label = "" }) {
    const button = (text, onclick, tip) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "small-btn"; b.textContent = text; b.title = tip;
      b.addEventListener("click", () => {
        const list = typeof blocks === "function" ? blocks() : blocks;
        if (!list || !list.length) { alert("Nothing to export yet."); return; }
        onclick(list);
      });
      return b;
    };
    const wrap = document.createElement("span");
    wrap.className = "doc-export-buttons";
    if (label) { const l = document.createElement("span"); l.className = "tool-group"; l.textContent = label; wrap.append(l); }
    wrap.append(
      button(label ? "PDF" : "Export PDF", (list) => print(list, { title }), "Opens the print window: choose “Save as PDF”"),
      button(label ? "Word" : "Export Word", (list) => downloadDocx(list, { title, filename: `${filename}.docx` }), "Downloads a .docx to open in Word, Pages or Google Docs"));
    return wrap;
  }

  window.DocExport = { print, downloadDocx, docxBlob, toHTML, download , buttons };
})();
