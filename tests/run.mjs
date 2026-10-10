// Runs the app's self-tests (pages/tests.html) and opens every page in a
// headless browser, the way CI does (.github/workflows/tests.yml):
//
//   npm install && npx playwright install --with-deps chromium
//   npm test
//
// Fails when a self-test fails, when any page throws an error while loading,
// or when a page asks for a file that isn't there.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".csv": "text/csv", ".pdf": "application/pdf", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };

// A small static server for the repository (the app needs http:// for fetch and IndexedDB)
const server = http.createServer((req, res) => {
  let file = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (file.endsWith("/")) file += "index.html";
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise(resolve => server.listen(0, resolve));
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
let failures = 0;
const fail = (message) => { failures++; console.log(`  ✗ ${message}`); };

async function open(file) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (err) => problems.push(`error: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error" && file !== "tests.html") problems.push(`console: ${msg.text()}`); });
  page.on("response", (res) => { if (res.status() >= 400) problems.push(`${res.status()}: ${res.url()}`); });
  page.on("requestfailed", (req) => problems.push(`failed request: ${req.url()}`));
  await page.goto(`${base}/pages/${file}`, { waitUntil: "load" });
  await page.evaluate(() => window.cobblerReady);   // boot.js has loaded the page's scripts
  return { context, page, problems };
}

// 1. The self-tests
console.log("Self-tests (pages/tests.html)");
{
  const { context, page, problems } = await open("tests.html");
  await page.click("#tests-run");
  await page.waitForFunction(() => /passed|failed/.test(document.getElementById("tests-summary").textContent), null, { timeout: 120_000 });
  const summary = await page.textContent("#tests-summary");
  console.log(`  ${summary.trim()}`);
  if (!/All \d+ tests passed/.test(summary)) {
    failures++;
    const details = await page.$$eval("#tests-list li.is-fail, #tests-list li", (items) => items.map(li => li.textContent.trim().replace(/\s+/g, " ")));
    details.filter(d => /expected|got|Error|✗/.test(d)).forEach(d => console.log(`    ${d}`));
  }
  problems.forEach(p => fail(p));
  await context.close();
}

// 2. Every page opens cleanly
console.log("\nPages");
for (const file of fs.readdirSync(path.join(ROOT, "pages")).filter(f => f.endsWith(".html")).sort()) {
  const { context, page, problems } = await open(file);
  await page.waitForTimeout(300);
  // Accessibility basics: every control named, every field labelled, every image described, ids unique
  const a11y = await page.evaluate(() => {
    const out = [];
    const visible = (e) => { const r = e.getBoundingClientRect(); return !e.closest("[hidden], [aria-hidden=true]") && getComputedStyle(e).display !== "none" && (r.width > 0 || r.height > 0); };
    const named = (e) => (e.getAttribute("aria-label") || "").trim() || e.getAttribute("aria-labelledby") || e.textContent.trim() || e.title || e.querySelector("img[alt], svg[aria-label], .visually-hidden")
      || (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || (e.closest("label") && e.closest("label").textContent.trim());
    for (const e of document.querySelectorAll("button, a[href], [role=tab]")) if (visible(e) && !named(e)) out.push(`unnamed control: ${e.tagName.toLowerCase()}#${e.id || "?"}.${e.className}`);
    for (const e of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=file]), select, textarea")) if (visible(e) && !named(e)) out.push(`unlabelled field: ${e.tagName.toLowerCase()}#${e.id || "?"} [${e.placeholder || ""}]`);
    for (const e of document.querySelectorAll("img")) if (visible(e) && !e.hasAttribute("alt")) out.push(`image without alt: ${e.src.split("/").pop()}`);
    const ids = {}; for (const e of document.querySelectorAll("[id]")) ids[e.id] = (ids[e.id] || 0) + 1;
    for (const [id, n] of Object.entries(ids)) if (n > 1) out.push(`duplicate id: #${id} ×${n}`);
    return out;
  });
  problems.push(...a11y);
  const title = await page.title();
  if (problems.length) { console.log(`  ${file} (${title})`); problems.forEach(p => fail(p)); }
  else console.log(`  ✓ ${file}`);
  await context.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} problem(s).` : "\nAll good.");
process.exit(failures ? 1 : 0);
