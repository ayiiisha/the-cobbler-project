// End-to-end flows through the parts of the app that are easiest to break: the loader,
// saving and reloading, undo in place, project switching, the shot list, the ideas panel,
// search, an Excel import and a transcript import. Runs after tests/run.mjs in CI:
//
//   npm run test:flows
//
// Each flow runs in a fresh browser context against a copy of the repository served locally.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "tests", "fixtures");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".csv": "text/csv",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".pdf": "application/pdf" };

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
const base = `http://localhost:${server.address().port}/pages/`;
const browser = await chromium.launch();

let failures = 0;
const results = [];
const check = (name, ok, detail = "") => { results.push(`  ${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` — ${String(detail).slice(0, 300)}`}`); if (!ok) failures++; };

/* Each flow gets its own browser context (fresh storage) and page */
async function flow(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: "block", acceptDownloads: true });
  await context.addInitScript(() => { try { localStorage.setItem("askedName", "1"); localStorage.setItem("cobblerMe", "Tester"); } catch {} });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message.split("\n")[0]));
  page.on("console", (msg) => { if (msg.type() === "error" && !/favicon|404/.test(msg.text())) errors.push(`console: ${msg.text().slice(0, 160)}`); });
  page.on("dialog", (d) => d.type() === "prompt" ? d.accept("Prompted") : d.accept());
  const go = async (file) => { await page.goto(base + file); await page.evaluate(() => window.cobblerReady); await page.waitForTimeout(150); };
  const download = async (action) => { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), action()]); return { name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), "utf8") }; };
  results.push(name);
  try { await fn({ page, go, download }); } catch (err) { check("flow completed", false, err.message.split("\n")[0]); }
  check("no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

const switchTo = (page, id) => page.evaluate((id) => { const s = document.getElementById("panel-project-select"); s.value = id; s.dispatchEvent(new Event("change", { bubbles: true })); }, id);

await flow("Ideas: cards save, empty cards vanish, undo and redo work in place", async ({ page, go }) => {
  await go("ideas.html");
  const add = page.locator(".ideas-column--1 .ideas-add");
  await add.click(); await page.keyboard.type("First idea"); await page.locator("h1").click(); await page.waitForTimeout(600);
  await add.click(); await add.click(); await page.keyboard.type("Second idea"); await page.locator("h1").click(); await page.waitForTimeout(600);
  await go("ideas.html");
  const cards = () => page.$$eval(".ideas-card textarea", ts => ts.map(t => t.value));
  check("two cards saved, no phantom empty card", JSON.stringify(await cards()) === JSON.stringify(["Second idea", "First idea"]), JSON.stringify(await cards()));
  await page.evaluate(() => { window.__stillHere = true; });
  await page.keyboard.press("Control+z"); await page.waitForTimeout(400);
  check("Ctrl+Z removes the last card without a reload", (await page.evaluate(() => window.__stillHere === true)) && JSON.stringify(await cards()) === JSON.stringify(["First idea"]), JSON.stringify(await cards()));
  await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(400);
  check("redo brings it back", JSON.stringify(await cards()) === JSON.stringify(["Second idea", "First idea"]));
});

await flow("Projects: switching redraws the page in place and remembers each project's open item", async ({ page, go }) => {
  await go("research.html");
  const ids = await page.evaluate(async () => {
    const a = Projects.activeId();
    Projects.getData("research", []); Projects.setData("research", [{ id: "r1", title: "Note in A", status: "unverified", notes: "", claim: "", sources: [], tags: [] }]);
    Projects.create("Project B", { activate: true });
    Projects.getData("research", []); Projects.setData("research", [{ id: "r2", title: "Note in B", status: "unverified", notes: "", claim: "", sources: [], tags: [] }]);
    Projects.switchTo(a);
    await Projects.flushed();
    return { a, b: Projects.list().find(p => p.name === "Project B").id };
  });
  await go("research.html");
  await page.evaluate(() => { window.__stillHere = true; });
  await switchTo(page, ids.b); await page.waitForTimeout(400);
  const text = await page.evaluate(() => document.body.innerText);
  check("switching shows project B's note without a reload", (await page.evaluate(() => window.__stillHere === true)) && /Note in B/.test(text) && !/Note in A/.test(text));
  check("the sidebar names project B", (await page.textContent("#project-button-current")) === "Project B");
  await go("screenplay.html"); await page.click("#sp-new"); await page.waitForTimeout(300);
  await page.evaluate(() => { window.__stillHere = true; });
  await switchTo(page, ids.a); await page.waitForTimeout(400);
  check("Screenplay switches project in place and forgets the other project's open script",
    (await page.evaluate(() => window.__stillHere === true && Projects.getData("screenplays", []).length === 0 && !localStorage.getItem(`screenplayCurrent:${Projects.activeId()}`))));
});

await flow("Shot list: numbering, imports, sorting, exports", async ({ page, go, download }) => {
  await go("shot-list.html");
  await page.click("#sl-new"); await page.fill("#sl-form [name=name]", "Day 1"); await page.fill("#sl-form [name=date]", "2026-11-02"); await page.fill("#sl-form [name=callTime]", "08:00");
  await page.click("#sl-form button[type=submit]"); await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) await page.click("#sl-add");
  const rows = page.locator("#sl-body tr");
  for (const [i, scene] of [["0", "12"], ["1", "12"], ["2", "13"]]) { const inp = rows.nth(Number(i)).locator(".sl-col-scene input"); await inp.fill(scene); await inp.dispatchEvent("input"); }
  await page.waitForTimeout(700);
  const numbers = () => page.$$eval(".sl-num", ns => ns.map(n => n.textContent));
  check("shots numbered by scene and order", JSON.stringify(await numbers()) === JSON.stringify(["12A", "12B", "13A"]), JSON.stringify(await numbers()));
  await page.evaluate(() => { Projects.getData("storyboards", []); Projects.setData("storyboards", [{ id: "b1", name: "Opening", kind: "video", aspect: "16:9", fps: 24, frames: [
    { id: "f1", scene: "1", shot: "Wide", move: "Static", duration: 4, action: "Street", dialogue: "", sound: "" }, { id: "f2", scene: "1", shot: "Close-up", move: "Push in", duration: 2, action: "Face", dialogue: "Go.", sound: "" }] }]); });
  await page.click("#sl-from-board"); await page.waitForTimeout(300);
  check("frames come in from the storyboard with links back", (await rows.count()) === 5 && (await page.locator(".sl-board-link").count()) === 2);
  await page.waitForTimeout(1600);
  await page.click("#sl-sort"); await page.waitForTimeout(200);
  check("sort by scene", JSON.stringify(await page.$$eval("#sl-body .sl-col-scene input", is => is.map(i => i.value))) === JSON.stringify(["1", "1", "12", "12", "13"]));
  await page.keyboard.press("Control+z"); await page.waitForTimeout(400);
  check("undo puts the order back", JSON.stringify(await page.$$eval("#sl-body .sl-col-scene input", is => is.map(i => i.value))) === JSON.stringify(["12", "12", "13", "1", "1"]));
  const csv = await download(() => page.click("#sl-csv-apps"));
  check("scheduling CSV has scene and shot columns", csv.text.startsWith("Scene,Shot,Shot Size") && /\r\n12,A,/.test(csv.text));
  const ics = await download(() => page.click("#sl-ics"));
  check("calendar file has the shoot day", /DTSTART;VALUE=DATE:20261102/.test(ics.text));
  const sheet = await page.evaluate(() => JSON.stringify(ShotList.callSheetBlocks(Projects.getData("shotLists")[0])));
  check("call sheet blocks include the schedule", /Call sheet: Day 1/.test(sheet) && /Schedule/.test(sheet));
});

await flow("Shot list and storyboard in one view, and the tour", async ({ page, go }) => {
  await go("shot-list.html");
  await page.evaluate(async () => {
    Projects.getData("storyboards", []); Projects.setData("storyboards", [{ id: "b1", name: "Opening", kind: "video", aspect: "16:9", fps: 24, frames: [
      { id: "f1", scene: "12", shot: "Wide", move: "Static", duration: 4, action: "The kitchen", dialogue: "", sound: "", strokes: [], texts: [] },
      { id: "f2", scene: "12", shot: "Close-up", move: "Push in", duration: 2, action: "The kettle", dialogue: "", sound: "", strokes: [], texts: [] }] }]);
    Projects.getData("shotLists", []); Projects.setData("shotLists", [{ id: "sl1", name: "Day 1", date: "", callTime: "", wrapTime: "", location: "", notes: "", access: "", hospital: "", weather: "", created: 1, updated: 1, shots: [
      { id: "a", scene: "12", size: "Wide", angle: "", move: "", lens: "", description: "Master", intExt: "", dayNight: "", seconds: "", minutes: "", gear: "", sound: "", notes: "", done: false, storyboardRef: { boardId: "b1", frameId: "f1" } },
      { id: "b", scene: "", size: "", angle: "", move: "", lens: "", description: "", intExt: "", dayNight: "", seconds: "", minutes: "", gear: "", sound: "", notes: "", done: false, storyboardRef: null }] }]);
    await Projects.flushed();
  });
  await go("about.html"); await go("shot-list.html#list=sl1");
  check("a linked shot shows its frame", (await page.locator("#sl-body tr").nth(0).locator(".sl-frame canvas").count()) === 1);
  await page.locator("#sl-body tr").nth(1).locator(".sl-frame").click(); await page.waitForTimeout(200);
  await page.locator(".sl-frame-pick").nth(1).click(); await page.waitForTimeout(300);
  const linked = await page.evaluate(() => Projects.getData("shotLists")[0].shots[1]);
  check("picking a frame links it and fills in size, move and scene", linked.storyboardRef?.frameId === "f2" && linked.size === "Close-up" && linked.move === "Push in" && linked.scene === "12");
  await page.click("#sl-view-board"); await page.waitForTimeout(300);
  check("board view shows a card per shot with its frame", (await page.locator(".sl-card-shot .sl-frame canvas").count()) === 2);
  await page.click("#sl-view-table");
  await go("index.html");
  await page.click("#tour-start"); await page.waitForTimeout(400);
  check("the tour starts on Home", /1 of \d+/.test(await page.textContent(".tour-count")));
  for (let i = 0; i < 8; i++) { await page.click(".tour-next"); await page.waitForTimeout(150); }
  await page.click(".tour-next"); await page.waitForTimeout(800); await page.evaluate(() => window.cobblerReady); await page.waitForTimeout(600);
  check("the tour carries on to the next page", /project-tracker\.html/.test(page.url()) && /10 of/.test(await page.textContent(".tour-count")), page.url());
  await page.keyboard.press("Escape");
  check("Esc leaves the tour", await page.evaluate(() => !localStorage.getItem("cobblerTour")));
});

await flow("Ideas panel and search: available on any page", async ({ page, go }) => {
  await go("research.html");
  await page.evaluate(async () => { Projects.getData("research", []); Projects.setData("research", [{ id: "r1", title: "Rent rose 40%", status: "unverified", notes: "Council data", claim: "", sources: [], tags: [] }]); await Projects.flushed(); });
  await page.click("#ideas-fab"); await page.waitForTimeout(200);
  await page.fill("#ideas-drawer-text", "A drone shot of the market"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  check("an idea jotted from the panel is saved", (await page.evaluate(() => Projects.getData("ideas", []).map(i => i.text)))[0] === "A drone shot of the market");
  await go("team.html");
  check("the panel stays open on the next page", !(await page.$eval("#ideas-drawer", e => e.hidden)));
  await page.fill("#site-search-input", "rent"); await page.waitForTimeout(400);
  const groups = await page.$$eval(".site-search-group h3", hs => hs.map(h => h.textContent));
  check("search finds the research note from another page", groups.includes("Research"), JSON.stringify(groups));
  await page.fill("#site-search-input", "drone"); await page.waitForTimeout(400);
  check("and the idea", (await page.$$eval(".site-search-group h3", hs => hs.map(h => h.textContent))).includes("Ideas"));
});

await flow("Data Analysis: an Excel workbook loads with a sheet picker", async ({ page, go }) => {
  await go("data-analysis.html");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#da-load")]);
  await chooser.setFiles(path.join(FIXTURES, "sales.xlsx"));
  await page.waitForSelector("#da-sheet[open]", { timeout: 5000 });
  await page.click("#da-sheet-list button:has-text(\"Sales\")"); await page.waitForTimeout(800);
  check("12 rows and 3 columns from the Sales sheet", /12 rows · 3 columns/.test(await page.textContent("#da-summary")), await page.textContent("#da-summary"));
  check("the R code uses readxl", /read_excel\("sales\.xlsx", sheet = "Sales"\)/.test(await page.evaluate(() => document.body.innerText)));
  await go("data-analysis.html");
  check("the dataset is still there after a reload", /12 rows/.test(await page.textContent("#da-summary")));
});

await flow("Media: a transcript imports, is searchable, and survives a reload", async ({ page, go }) => {
  await go("media-and-transcripts.html");
  const srt = path.join(FIXTURES, "interview.srt");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#transcript-import")]);
  await chooser.setFiles(srt); await page.waitForTimeout(800);
  check("three paragraphs imported", /3 paragraphs/.test(await page.textContent("#transcript-list")));
  await page.fill("#media-search", "thanks"); await page.waitForTimeout(400);
  check("search finds a line", /Fine, thanks/.test(await page.textContent("#media-results")));
  await go("media-and-transcripts.html");
  check("still there after a reload", /3 paragraphs/.test(await page.textContent("#transcript-list")));
});

await flow("Settings: storage, backups and browser panels render", async ({ page, go }) => {
  await go("settings.html");
  check("storage meter", /database/i.test(await page.textContent("#storage-panel")));
  check("backups panel", /Back up automatically|Automatic backups/.test(await page.textContent("#backups-panel")));
  check("browser panel", (await page.$$("#browser-panel li")).length === 6);
});

await browser.close();
server.close();
console.log(results.join("\n"));
console.log(failures ? `\n${failures} problem(s).` : "\nAll flows passed.");
process.exit(failures ? 1 : 0);
