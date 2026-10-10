// Keeps sw.js honest: its VERSION must change whenever any file it caches changes,
// or visitors with an offline copy keep the old app for up to a day.
//
//   node tests/version.mjs --check    fails when VERSION or the PRECACHE list is out of date (CI runs this)
//   node tests/version.mjs --write    rewrites PRECACHE from the files in the repository and sets VERSION
//                                     to "<date>-<hash>", where the hash covers every cached file's contents
//
// Run --write after changing any file, before committing. (A deploy with an unchanged VERSION
// isn't broken, just slow to reach people who already have the app.)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SW = path.join(ROOT, "sw.js");

// Everything the app is made of (not the tooling, tests or hidden files)
function listFiles() {
  const out = ["index.html", "manifest.webmanifest", "default-resources-cobbler-project.csv"];
  const walk = (dir, filter = () => true) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel, filter);
      else if (filter(rel)) out.push(rel);
    }
  };
  walk("pages", f => f.endsWith(".html"));
  walk("resources/css", f => f.endsWith(".css"));
  walk("resources/js", f => f.endsWith(".js"));
  walk("resources/data", f => f.endsWith(".js"));
  walk("resources/assets");
  walk("resources/docs");
  walk("resources/vendor");
  return [...new Set(out)].filter(f => fs.existsSync(path.join(ROOT, f))).sort();
}

function hashOf(files) {
  const h = crypto.createHash("sha256");
  for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); }
  return h.digest("hex").slice(0, 10);
}

const files = listFiles();
const hash = hashOf(files);
const sw = fs.readFileSync(SW, "utf8");
const current = /const VERSION = "([^"]+)";/.exec(sw)?.[1] || "";
const listed = [...sw.matchAll(/^  "([^"]+)",?$/gm)].map(m => m[1]).sort();
const sameList = JSON.stringify(listed) === JSON.stringify(files);
const sameHash = current.endsWith(`-${hash}`);

if (process.argv.includes("--write")) {
  const date = new Date().toISOString().slice(0, 10);
  const version = `${date}-${hash}`;
  let next = sw.replace(/const VERSION = "[^"]+";/, `const VERSION = "${version}";`);
  next = next.replace(/const PRECACHE = \[\n[\s\S]*?\n\];/, `const PRECACHE = [\n${files.map(f => `  ${JSON.stringify(f)}`).join(",\n")}\n];`);
  fs.writeFileSync(SW, next);
  console.log(`sw.js: VERSION ${version}, ${files.length} files in PRECACHE`);
} else {
  const problems = [];
  if (!sameList) {
    const missing = files.filter(f => !listed.includes(f)), extra = listed.filter(f => !files.includes(f));
    problems.push(`PRECACHE is out of date${missing.length ? `: missing ${missing.join(", ")}` : ""}${extra.length ? `; no longer exist: ${extra.join(", ")}` : ""}`);
  }
  if (!sameHash) problems.push(`VERSION "${current}" doesn't match the files (expected it to end in -${hash})`);
  if (problems.length) {
    console.error(`sw.js needs updating:\n  ${problems.join("\n  ")}\nRun: node tests/version.mjs --write`);
    process.exit(1);
  }
  console.log(`sw.js is up to date (VERSION ${current}, ${files.length} files)`);
}
