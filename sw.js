/* =========================================================
   sw.js — the service worker: offline use and "Install"
   ---------------------------------------------------------
   Lives at the site's root (next to index.html) so it covers
   every page. header.js registers it once a page has loaded.

   What it does:
     1. On install, keeps a copy of every file the app is made of
        (the PRECACHE list below), so the whole app opens with no
        connection. Projects aren't involved: they live in the
        browser's database, not in this cache.
     2. On every request for one of the app's own files, answers
        from the copy at once and fetches a fresh one in the
        background for next time ("stale while revalidate").
     3. When the app changes, VERSION below changes with it; the
        new worker makes a new cache, takes over, and throws the
        old cache away. header.js then offers to reload.

   After changing any file in the app, bump VERSION (the self-tests'
   run script and the ZIP download don't need it, but visitors
   with an older copy do, to receive the new one promptly).
   ========================================================= */
const VERSION = "2026-10-10a";
const CACHE = `cobbler-${VERSION}`;

const PRECACHE = [
  "default-resources-cobbler-project.csv",
  "index.html",
  "manifest.webmanifest",
  "pages/about.html",
  "pages/av-script.html",
  "pages/calendar.html",
  "pages/data-analysis.html",
  "pages/ideas.html",
  "pages/index.html",
  "pages/interviews.html",
  "pages/media-and-transcripts.html",
  "pages/music.html",
  "pages/packaging.html",
  "pages/pitches.html",
  "pages/project-tracker.html",
  "pages/projects.html",
  "pages/research.html",
  "pages/resources.html",
  "pages/screenplay.html",
  "pages/settings.html",
  "pages/storyboarder.html",
  "pages/team.html",
  "pages/tests.html",
  "pages/writing.html",
  "pages/zine-planner.html",
  "resources/assets/cobbler-logo.svg",
  "resources/assets/icon-192.png",
  "resources/assets/icon-512.png",
  "resources/css/style.css",
  "resources/data/default-resources-cobbler-project.js",
  "resources/docs/code-guide.html",
  "resources/docs/code-guide.pdf",
  "resources/docs/docs.css",
  "resources/docs/user-guide.html",
  "resources/docs/user-guide.pdf",
  "resources/js/account.js",
  "resources/js/av-script.js",
  "resources/js/boot.js",
  "resources/js/calendar.js",
  "resources/js/color-themes.js",
  "resources/js/comments.js",
  "resources/js/dashboard.js",
  "resources/js/data-analysis.js",
  "resources/js/doc-export.js",
  "resources/js/file-store.js",
  "resources/js/header.js",
  "resources/js/ideas.js",
  "resources/js/interviews.js",
  "resources/js/media-core.js",
  "resources/js/media.js",
  "resources/js/music-business.js",
  "resources/js/music-core.js",
  "resources/js/music-songs.js",
  "resources/js/packaging.js",
  "resources/js/pitches.js",
  "resources/js/project-tracker.js",
  "resources/js/project-ui.js",
  "resources/js/projects-core.js",
  "resources/js/projects-sync.js",
  "resources/js/projects.js",
  "resources/js/report.js",
  "resources/js/research.js",
  "resources/js/resources.js",
  "resources/js/screenplay.js",
  "resources/js/script.js",
  "resources/js/settings.js",
  "resources/js/share.js",
  "resources/js/sketch-core.js",
  "resources/js/storyboarder.js",
  "resources/js/sync.js",
  "resources/js/team-tasks.js",
  "resources/js/team.js",
  "resources/js/tests.js",
  "resources/js/text-edit.js",
  "resources/js/timeline-export.js",
  "resources/js/undo.js",
  "resources/js/util.js",
  "resources/js/writing-business.js",
  "resources/js/writing-check.js",
  "resources/js/writing-core.js",
  "resources/js/writing-draft.js",
  "resources/js/writing-reporting.js",
  "resources/js/writing-revisions.js",
  "resources/js/writing-story.js",
  "resources/js/zine-critique.js",
  "resources/js/zine-planner.js",
  "resources/js/zine-sketch.js",
  "resources/js/zip.js",
  "resources/vendor/abcjs/LICENSE.txt",
  "resources/vendor/abcjs/abcjs-basic-6.4.4.min.js",
  "resources/vendor/lz-string/LICENSE.txt",
  "resources/vendor/lz-string/lz-string-1.5.0.min.js"
];

const here = (path) => new URL(path, self.registration.scope).href;

/* ---------- 1. Install: copy every file ---------- */
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One at a time rather than cache.addAll, so a single missing file
    // (an optional PDF, say) doesn't stop the whole app from installing
    for (const path of PRECACHE) {
      try {
        const response = await fetch(here(path), { cache: "no-cache" });
        if (response.ok) await cache.put(here(path), response);
      } catch {}
    }
    await self.skipWaiting();
  })());
});

/* ---------- 3. Activate: drop older caches, take over open pages ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith("cobbler-") && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "skipWaiting") self.skipWaiting();
});

/* ---------- 2. Fetch: answer from the copy, refresh it in the background ---------- */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.href.startsWith(self.registration.scope)) return;   // not one of ours
  if (url.pathname.endsWith("/sw.js")) return;                                                   // the browser checks this one itself

  const isPage = request.mode === "navigate";
  const network = (async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return null;
    }
  })();
  event.waitUntil(network.catch(() => {}));   // (started here, synchronously, so it's allowed to run on)

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: isPage });
    if (cached) return cached;
    const fresh = await network;
    if (fresh) return fresh;
    if (isPage) {
      const home = await caches.match(here("pages/index.html"));
      if (home) return home;
    }
    return new Response("You're offline, and this part of The Cobbler Project hasn't been saved for offline use yet.",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  })());
});
