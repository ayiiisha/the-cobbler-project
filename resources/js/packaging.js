/* =========================================================
   packaging.js — the Packaging page (titles, thumbnails, SEO)
   ---------------------------------------------------------
   One "package" per place the work will appear (a YouTube
   video, a reel, an article, a newsletter, a zine listing…).
   Each package is a brainstorm and a checklist for:
     titles · thumbnail concepts · description or caption ·
     tags, keywords and hashtags · alt text · web SEO fields
   with live character counts against the platform's limits,
   previews, and an SEO checklist.

   It also borrows from the rest of the project:
     • YouTube chapters from a paper edit's sections (Text Edit)
     • a credits block from the Team page's roles
     • keyword ideas from the Project Tracker's Taxonomy

   Saved inside the active project:
     project.data.packaging = [{
       id, name, platform, keyword, keywords: [], audience, notes,
       titles: [{ id, text, chosen }],
       thumbs: [{ id, text, notes, image, chosen }],     (image: FileStore id)
       description, tags: [], hashtags: [],
       images: [{ id, label, alt }],
       seoTitle, metaDescription, slug, shareTitle, shareDescription,
       previewText, created, updated,
       deliverables: { done: { itemId: true }, custom: [{ id, text, done }] },
       storyId, pitchId,   (packages made together for one story share
                            their keywords and audience; pitchId = the pitch they came from)
     }, ...]

   Deliverables: what to render and hand over for each platform,
   with the DaVinci Resolve settings for each (DELIVERABLES).

   Needs projects-core.js and file-store.js (media-core.js for chapters).
   ========================================================= */
(() => {

  if (!window.Projects) {
    console.error("packaging.js: window.Projects is missing. Load projects-core.js first.");
    return;
  }

  const $ = (id) => document.getElementById(id);


  /* =========================================================
     PLATFORMS
     limit = the platform's hard limit; ideal = a guide for what
     shows fully in feeds and search results (both in characters).
     Limits change from time to time; edit them here.
     ========================================================= */

  const PLATFORMS = {
    youtube: {
      name: "YouTube video", note: "Long-form video",
      title: { label: "Title", limit: 100, ideal: 60 },
      description: { label: "Description", limit: 5000, fold: 150 },
      tags: { totalLimit: 500 },
      hashtags: { max: 15, shown: 3 },
      thumb: { ratio: 16 / 9, size: "1280 × 720 px" },
      chapters: true, credits: true,
    },
    short: {
      name: "Shorts, Reels or TikTok", note: "Vertical short video",
      title: { label: "Title", plural: "Titles and hooks", limit: 100, ideal: 40 },
      description: { label: "Caption", limit: 2200, fold: 100 },
      hashtags: { max: 5 },
      thumb: { ratio: 9 / 16, size: "1080 × 1920 px (cover frame)" },
      credits: true,
    },
    instagram: {
      name: "Instagram post", note: "Photos or a carousel",
      description: { label: "Caption", limit: 2200, fold: 125 },
      hashtags: { max: 30 },
      thumb: { label: "Image ideas", ratio: 4 / 5, size: "1080 × 1350 px" },
      alt: true, credits: true,
    },
    article: {
      name: "Article or web page", note: "Written story, blog, portfolio",
      title: { label: "Headline", limit: null, ideal: 70 },
      description: { label: "Standfirst / summary", limit: null, fold: 160 },
      thumb: { label: "Share image ideas", ratio: 1.91, size: "1200 × 630 px (social share image)" },
      seo: true, alt: true, credits: true,
    },
    newsletter: {
      name: "Newsletter", note: "Email to subscribers",
      title: { label: "Subject line", limit: null, ideal: 50 },
      previewText: { label: "Preview text", ideal: 90 },
      description: { label: "Intro", limit: null, fold: 200 },
      alt: true,
    },
    zine: {
      name: "Zine shop listing", note: "Etsy, Big Cartel, your own shop",
      title: { label: "Listing title", limit: 140, ideal: 70 },
      description: { label: "Listing description", limit: null, fold: 160 },
      tags: { count: 13, eachLimit: 20 },
      thumb: { label: "Cover photo ideas", ratio: 4 / 5, size: "Cover photo (portrait)" },
      seo: true, alt: true,
    },
    podcast: {
      name: "Podcast episode", note: "Audio",
      title: { label: "Episode title", limit: null, ideal: 60 },
      description: { label: "Show notes", limit: 4000, fold: 150 },
      thumb: { label: "Cover art ideas", ratio: 1, size: "3000 × 3000 px (square art)" },
      chapters: true, credits: true,
    },
    other: {
      name: "Something else", note: "Any other platform",
      title: { label: "Title", limit: null, ideal: 70 },
      description: { label: "Description", limit: null, fold: 150 },
      hashtags: { max: 10 },
      thumb: { ratio: 16 / 9, size: "" },
      alt: true, credits: true,
    },
  };

  /* Title formulas to spark ideas. [K] = the primary keyword (or topic). */
  const TITLE_FORMULAS = [
    "Why [K] …", "Inside [K]", "The hidden cost of [K]", "What happened to [K]?", "[K], explained",
    "How [K] really works", "Who profits from [K]?", "I spent a month with [K]", "The fight over [K]", "[K]: what nobody tells you",
  ];

  const ALT_IDEAL = 125;

  /* What to deliver for each platform, with where to find it in DaVinci Resolve.
     Platforms change their specs from time to time; edit them here. */
  const VIDEO_ARCHIVE = { id: "archive", label: "Project archive for collaborators",
    detail: "File › Export Project… (.drp) so friends can open the edit in their Resolve; File › Media Management… to copy just the media it uses." };
  const DELIVERABLES = {
    youtube: [
      { id: "master", label: "Master render", detail: "Deliver page › YouTube preset (or H.264/H.265 Master). 3840 × 2160 if you shot 4K (YouTube streams 4K uploads at a higher quality), otherwise 1920 × 1080; frame rate the same as the timeline; MP4." },
      { id: "loudness", label: "Audio loudness about −14 LUFS", detail: "Fairlight page › Loudness meter: about −14 LUFS integrated, true peak below −1 dBTP." },
      { id: "captions", label: "Captions file (.srt)", detail: "File › Export › Subtitle… from the subtitle track, or Render Settings › Subtitle Settings › Export Subtitle › As a separate file." },
      { id: "thumb", label: "Thumbnail 1280 × 720", detail: "JPG or PNG under 2 MB. For a frame: Color page › right-click the viewer › Grab Still, then right-click the still › Export." },
      { id: "chapters", label: "Chapters in the description", detail: "Start at 00:00, 3 or more, each at least 10 seconds." },
      { id: "endscreen", label: "Room for an end screen", detail: "Keep the last 5–20 seconds clear of key text if you'll add YouTube end-screen links." },
      VIDEO_ARCHIVE,
    ],
    short: [
      { id: "vertical", label: "Vertical render 1080 × 1920", detail: "Make the timeline vertical: Timeline › Timeline Settings › untick Use Project Settings › 1080 × 1920. Then Deliver page › TikTok preset, or Custom at 1080 × 1920, H.264, MP4." },
      { id: "burnin", label: "Burned-in captions", detail: "Render Settings › Subtitle Settings › Export Subtitle › Burn into video. Keep them in the middle of the frame, clear of each app's buttons." },
      { id: "loudness", label: "Audio loudness about −14 LUFS", detail: "Fairlight page › Loudness meter." },
      { id: "cover", label: "Cover frame", detail: "Pick a frame with readable text; 1080 × 1920." },
      { id: "length", label: "Length checked for each app", detail: "Shorts, Reels and TikTok each have their own maximum length, and they change: check before you post." },
      VIDEO_ARCHIVE,
    ],
    instagram: [
      { id: "images", label: "Images at 1080 × 1350 (4:5)", detail: "From Resolve: Color page › Grab Still › Export. Or Deliver › Custom › Export Video at 1080 × 1350 for a video post." },
      { id: "alt", label: "Alt text for every image", detail: "Advanced settings › Accessibility › Write alt text (or when you post)." },
      { id: "order", label: "Carousel order checked", detail: "The first image is the thumbnail in feeds and the grid." },
    ],
    article: [
      { id: "share", label: "Share image 1200 × 630", detail: "Used when the link is posted on social media and in messages." },
      { id: "images", label: "Images compressed for the web", detail: "Under about 300 KB each; JPG or WebP." },
      { id: "video", label: "Video uploaded and embedded", detail: "Upload the video first (YouTube, Vimeo) and embed it near the top." },
      { id: "alt", label: "Alt text for every image" },
      { id: "links", label: "Links and sources checked" },
    ],
    newsletter: [
      { id: "header", label: "Header image", detail: "About 1200 px wide, under 1 MB." },
      { id: "test", label: "Test email sent to yourself", detail: "Check it on a phone and in dark mode." },
      { id: "links", label: "Links checked" },
      { id: "alt", label: "Alt text for images" },
    ],
    zine: [
      { id: "print", label: "Print-ready PDF", detail: "At the printer's page size, with bleed if they ask for it (usually 3 mm / 0.125 in)." },
      { id: "photos", label: "Cover and listing photos", detail: "Good light, the cover first, then inside spreads." },
      { id: "digital", label: "Digital PDF (if selling one)", detail: "Smaller file, pages in reading order." },
      { id: "shipping", label: "Weight, price and shipping set" },
      { id: "alt", label: "Alt text for the cover photo" },
    ],
    podcast: [
      { id: "audio", label: "Audio render", detail: "Deliver page › Audio Only preset (or Custom with Export Video unticked): WAV for the master, MP3 at 128–192 kbps for upload." },
      { id: "loudness", label: "Loudness about −16 LUFS", detail: "Fairlight page › Loudness meter. About −16 LUFS integrated for stereo, true peak below −1 dBTP." },
      { id: "art", label: "Cover art 3000 × 3000" },
      { id: "notes", label: "Show notes with timestamps" },
      { id: "transcript", label: "Transcript", detail: "File › Export › Subtitle… (.srt) from Resolve's subtitles, or a .txt." },
      VIDEO_ARCHIVE,
    ],
    other: [
      { id: "master", label: "Master render", detail: "Deliver page › H.264 Master or the platform's preset; frame rate the same as the timeline." },
      { id: "captions", label: "Captions file (.srt)", detail: "File › Export › Subtitle…" },
      VIDEO_ARCHIVE,
    ],
  };


  /* =========================================================
     SMALL HELPERS
     ========================================================= */

  const el = Cobbler.el;

  const newId = Cobbler.newId;
  const words = (text) => (String(text).trim().match(/\S+/g) || []).length;
  const slugify = (text) => String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const includesWord = (text, keyword) => !!keyword.trim() && String(text).toLowerCase().includes(keyword.trim().toLowerCase());
  const cut = (text, n) => text.length > n ? text.slice(0, n - 1).trimEnd() + "…" : text;

  const setStatus = Cobbler.statusLine("pk-status", 6000);

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); setStatus(`${what} copied.`); }
    catch { prompt(`Copy the ${what.toLowerCase()}:`, text); }
  }

  const download = Cobbler.download;

  /* "42 / 100" with a bar; amber near the guide, red over the limit */
  function counter(text, { ideal = null, limit = null, unit = "characters" } = {}) {
    const node = el("span", { class: "pk-count" });
    const update = (value) => {
      const n = String(value).length;
      const max = limit || ideal;
      node.textContent = max ? `${n} / ${max}` : `${n} ${unit}`;
      node.title = [ideal && `About ${ideal} shows in full in feeds and search`, limit && `Limit ${limit}`].filter(Boolean).join(" · ");
      node.classList.toggle("is-over", !!limit && n > limit);
      node.classList.toggle("is-long", !!ideal && n > ideal && !(limit && n > limit));
    };
    update(text);
    return { node, update };
  }


  /* =========================================================
     SAVED DATA
     ========================================================= */

  let packages = [];
  function loadData() {
    packages = Projects.getData("packaging", []);
    if (!Array.isArray(packages)) packages = [];
    packages.forEach(p => {
    if (!PLATFORMS[p.platform]) p.platform = "other";
    for (const key of ["titles", "thumbs", "tags", "hashtags", "images", "keywords"]) p[key] = Array.isArray(p[key]) ? p[key] : [];
    for (const key of ["name", "keyword", "audience", "notes", "description", "seoTitle", "metaDescription", "slug",
                       "shareTitle", "shareDescription", "previewText"]) p[key] ??= "";
    p.deliverables = p.deliverables && typeof p.deliverables === "object" ? p.deliverables : {};
    p.deliverables.done ||= {};
    p.deliverables.custom = Array.isArray(p.deliverables.custom) ? p.deliverables.custom : [];
    });
  }
  loadData();

  let saveTimer = 0;
  function save({ soon = false } = {}) {
    clearTimeout(saveTimer);
    const write = () => { const p = current(); if (p) p.updated = Date.now(); Projects.setData("packaging", packages); };
    if (soon) saveTimer = setTimeout(write, 400); else write();
  }
  window.addEventListener("pagehide", () => { if (saveTimer) { clearTimeout(saveTimer); Projects.setData("packaging", packages); } });

  const currentKey = () => `packagingCurrent:${Projects.activeId()}`;   // (a function: the project can change without a reload)
  const remembered = () => { try { return localStorage.getItem(currentKey()); } catch { return null; } };
  let currentId = remembered();
  const current = () => packages.find(p => p.id === currentId) || null;

  /* The open package as a document: chosen title and thumbnail first, then everything else */
  function exportBlocks() {
    const p = current();
    if (!p) return [];
    const list = (a) => Array.isArray(a) ? a : [];
    const chosen = list(p.titles).find(t => t.chosen);
    const custom = list(p.deliverables?.custom);
    const doneIds = p.deliverables?.done || {};
    return [
      { t: "title", text: p.name || "Package" },
      { t: "meta", text: [p.platform, p.keyword && `Keyword: ${p.keyword}`, p.audience && `Audience: ${p.audience}`, new Date().toLocaleDateString()].filter(Boolean).join(" · ") },
      list(p.titles).length && { t: "h2", text: "Titles" },
      list(p.titles).length && { t: "list", items: list(p.titles).map(t => `${t.text}${t.chosen ? "  ← chosen" : ""}`) },
      list(p.thumbs).length && { t: "h2", text: "Thumbnail ideas" },
      list(p.thumbs).length && { t: "list", items: list(p.thumbs).map(t => `${t.text}${t.notes ? ` (${t.notes})` : ""}${t.chosen ? "  ← chosen" : ""}`) },
      (p.description || "").trim() && { t: "h2", text: "Description" },
      (p.description || "").trim() && { t: "p", text: p.description },
      { t: "fields", items: [
        ["Tags", list(p.tags).join(", ")], ["Hashtags", list(p.hashtags).join(" ")], ["Keywords", list(p.keywords).join(", ")],
        ["SEO title", p.seoTitle], ["Meta description", p.metaDescription], ["Slug", p.slug],
        ["Share title", p.shareTitle], ["Share description", p.shareDescription], ["Preview text", p.previewText],
      ].filter(([, v]) => v && String(v).trim()) },
      list(p.images).length && { t: "h2", text: "Image alt text" },
      list(p.images).length && { t: "table", head: ["Image", "Alt text"], rows: list(p.images).map(i => [i.label || "", i.alt || ""]) },
      (Object.keys(doneIds).length || custom.length) && { t: "h2", text: "Deliverables" },
      (Object.keys(doneIds).length || custom.length) && { t: "checks", items: [...Object.entries(doneIds).filter(([, v]) => v).map(([id]) => ({ text: id, done: true })), ...custom.map(c => ({ text: c.text, done: !!c.done }))] },
      (p.notes || "").trim() && { t: "h2", text: "Notes" },
      (p.notes || "").trim() && { t: "p", text: p.notes },
      chosen && { t: "meta", text: `Chosen title: ${chosen.text}` },
    ].filter(Boolean);
  }
  const config = (p) => PLATFORMS[p.platform];
  const chosenTitle = (p) => (p.titles.find(t => t.chosen) || p.titles[0])?.text || "";

  /* Packages made together for one story share their keywords and audience */
  const siblings = (p) => p.storyId ? packages.filter(x => x !== p && x.storyId === p.storyId) : [];
  function syncStory(p) {
    siblings(p).forEach(x => { x.keyword = p.keyword; x.keywords = [...p.keywords]; x.audience = p.audience; });
  }


  /* ---------- Images (thumbnail mock-ups) ---------- */

  const imageUrls = new Map();
  async function imageUrl(id) {
    if (!id || !window.FileStore) return null;
    if (!imageUrls.has(id)) {
      imageUrls.set(id, FileStore.get(id).then(b => b ? URL.createObjectURL(b) : null).catch(() => null));
    }
    return imageUrls.get(id);
  }

  async function releaseImage(id) {
    if (!id) return;
    const used = Projects.collect("packaging").flat().some(p => (p?.thumbs || []).some(t => t.image === id));
    if (!used) await FileStore.remove(id).catch(() => {});
  }


  /* =========================================================
     BORROWED FROM ELSEWHERE IN THE PROJECT
     ========================================================= */

  // Paper edits (Text Edit) with their sections, for YouTube chapters
  function editsWithChapters() {
    if (!window.MediaCore) return [];
    return MediaCore.loadEdits().map(edit => {
      let clock = 0;
      const chapters = [];
      edit.blocks.forEach((b, i) => {
        if (b.kind === "section") chapters.push({ at: clock, name: b.text.trim() || "Untitled section" });
        else if (i === 0) chapters.push({ at: 0, name: "Intro" });
        clock += MediaCore.blockSeconds(b);
      });
      if (chapters.length && chapters[0].at > 0) chapters.unshift({ at: 0, name: "Intro" });
      return { edit, chapters: chapters.filter((c, i, all) => !all[i + 1] || all[i + 1].at > c.at), total: clock };
    }).filter(e => e.edit.blocks.length);
  }

  /* Chapters from markers imported from Resolve: every marker, or one colour */
  function markerChapters() {
    if (!window.MediaCore) return [];
    const sets = MediaCore.loadMedia().markerSets || [];
    return sets.flatMap(set => {
      const build = (list, label) => {
        let chapters = list.map(m => ({ at: Math.max(0, m.at - set.start), name: m.name || m.note || `${m.color} marker` }))
          .sort((a, b) => a.at - b.at);
        if (!chapters.length) return null;
        if (chapters[0].at >= 1) chapters.unshift({ at: 0, name: "Intro" });
        chapters = chapters.filter((ch, i, all) => !all[i + 1] || all[i + 1].at > ch.at);
        const last = Math.max(...set.markers.map(m => m.at + (m.duration || 0))) - set.start;
        return { label, chapters, total: Math.max(last, chapters[chapters.length - 1].at + 10) };
      };
      const colors = [...new Set(set.markers.map(m => m.color))];
      return [build(set.markers, `${set.file}: all markers`),
              ...(colors.length > 1 ? colors.map(col => build(set.markers.filter(m => m.color === col), `${set.file}: ${col} only`)) : [])]
        .filter(Boolean);
    });
  }

  const stamp = (s) => {
    const t = Math.floor(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${String(m).padStart(2, "0")}:${sec}`;
  };

  // Credits from the Team page: "Producer: Sam Rivera, Aisha"
  function creditsText() {
    const team = Projects.getData("team", []);
    if (!Array.isArray(team) || !team.length) return "";
    const byRole = new Map();
    team.forEach(m => (m.roles?.length ? m.roles : ["Team"]).forEach(r => {
      if (!byRole.has(r)) byRole.set(r, []);
      byRole.get(r).push(m.name);
    }));
    return "Credits\n" + [...byRole.entries()].map(([role, names]) => `${role}: ${names.join(", ")}`).join("\n");
  }

  // Keyword ideas: the Project Tracker's taxonomy, plus this package's other keywords
  function keywordIdeas(p) {
    const tracker = Projects.getData("tracker", {}) || {};
    return [...new Set(String(tracker.taxonomy || "").split(",").map(t => t.trim()).filter(Boolean))]
      .filter(t => !p.keywords.includes(t) && t !== p.keyword);
  }


  /* =========================================================
     THE PACKAGE TABS
     ========================================================= */

  function renderTabs() {
    $("pk-tabs").replaceChildren(...packages.map(p => el("button", {
      type: "button", class: "pk-tab", "aria-pressed": String(p.id === currentId),
      onclick: () => { select(p.id); },
    }, el("span", { class: "pk-tab-platform" }, config(p).name), p.name || chosenTitle(p) || "Untitled")));
  }

  function select(id) {
    currentId = id;
    try { localStorage.setItem(currentKey(), id); } catch {}
    render();
  }


  /* =========================================================
     THE EDITOR
     ========================================================= */

  function render() {
    renderTabs();
    const p = current() || packages[0];
    if (p && p.id !== currentId) { currentId = p.id; }
    const box = $("pk-editor");
    if (!p) {
      box.replaceChildren(el("p", { class: "media-empty" }, "No packages yet. Make one for each place your work will appear: “+ New package”."));
      return;
    }
    const c = config(p);
    box.replaceChildren(
      el("div", { class: "pk-columns" },
        el("div", { class: "pk-main" },
          basicsSection(p),
          c.title && titlesSection(p),
          c.thumb && thumbsSection(p),
          descriptionSection(p),
          tagsSection(p),
          c.alt && altSection(p),
          c.seo && seoSection(p),
          deliverablesSection(p)),
        el("aside", { class: "pk-side" },
          el("section", { class: "pk-card pk-preview-card" }, el("h2", {}, "Preview"), el("div", { id: "pk-preview" })),
          el("section", { class: "pk-card" }, el("h2", {}, "Checklist"), el("ul", { class: "pk-checks", id: "pk-checks" })),
          exportSection(p))));
    refresh();
  }

  /* Re-draws the parts that depend on everything else (keeps typing in place) */
  function refresh() {
    const p = current();
    if (!p) return;
    renderPreview(p);
    renderChecks(p);
  }

  /* Wires a text box to a field: counts, saves, refreshes previews */
  function field(p, key, { textarea = false, rows = 3, placeholder = "", ideal = null, limit = null, label, hint = null, onInput = null } = {}) {
    const input = textarea
      ? el("textarea", { rows: String(rows), placeholder, "aria-label": label })
      : el("input", { placeholder, "aria-label": label, autocomplete: "off" });
    input.value = p[key] || "";
    const count = (ideal || limit) ? counter(input.value, { ideal, limit }) : null;
    input.addEventListener("input", () => {
      p[key] = input.value;
      count?.update(input.value);
      onInput?.(input.value);
      save({ soon: true });
      refresh();
    });
    return el("label", { class: "pk-field" },
      el("span", { class: "pk-field-head" }, label, count?.node),
      input,
      hint && el("span", { class: "pk-hint" }, hint));
  }

  /* ---------- Basics ---------- */
  function basicsSection(p) {
    const platform = el("select", { class: "team-select", "aria-label": "Platform" },
      Object.entries(PLATFORMS).map(([id, c]) => el("option", { value: id }, c.name)));
    platform.value = p.platform;
    platform.addEventListener("change", () => { p.platform = platform.value; save(); render(); });

    const ideas = keywordIdeas(p);
    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" },
        el("h2", {}, "The basics"),
        el("div", { class: "comment-actions" },
          window.ProjectShare?.claimButton && ProjectShare.claimButton(p.id, p.name || chosenTitle(p) || config(p).name),
          el("button", { type: "button", class: "comment-action", onclick: () => duplicatePackage(p) }, "Duplicate"),
          el("button", { type: "button", class: "comment-action", onclick: () => deletePackage(p) }, "Delete package"))),
      el("div", { class: "zine-form-row" },
        field(p, "name", { label: "Package name", placeholder: "e.g. Full documentary", onInput: renderTabs }),
        el("label", { class: "pk-field" }, el("span", { class: "pk-field-head" }, "Platform"), platform)),
      siblings(p).length > 0 && el("p", { class: "pk-linked" },
        `One story with ${siblings(p).map(x => config(x).name).join(", ")}: the keywords and audience are shared between them. `,
        el("button", { type: "button", class: "comment-action", onclick: () => {
          if (!confirm("Stop sharing keywords and audience with the other packages for this story?")) return;
          delete p.storyId; save(); render();
        } }, "Unlink")),
      field(p, "keyword", { label: "Primary keyword or topic", placeholder: "What would someone type to find this? e.g. rent increases Chicago",
        hint: "The checklist looks for it in your title, description and tags.", onInput: () => syncStory(p) }),
      el("div", { class: "pk-field" },
        el("span", { class: "pk-field-head" }, "Other keywords"),
        chips(p.keywords, { placeholder: "Add a keyword and press Enter", onChange: () => { syncStory(p); save(); refresh(); } }),
        ideas.length > 0 && el("p", { class: "pk-hint" }, "From your Project Tracker taxonomy: ",
          ideas.map(t => el("button", { type: "button", class: "team-chip team-chip--toggle pk-suggest", onclick: () => { p.keywords.push(t); syncStory(p); save(); render(); } }, `+ ${t}`)))),
      field(p, "audience", { label: "Who it's for", placeholder: "e.g. tenants in Chicago, local news readers", onInput: () => syncStory(p) }));
  }

  /* ---------- Titles ---------- */
  function titlesSection(p) {
    const c = config(p).title;
    const list = el("ol", { class: "pk-options" });
    const draw = () => list.replaceChildren(...p.titles.map((t, i) => {
      const input = el("input", { value: t.text, "aria-label": `${c.label} idea ${i + 1}`, placeholder: `${c.label} idea` });
      const count = counter(t.text, { ideal: c.ideal, limit: c.limit });
      const keyword = el("span", { class: "pk-flag" });
      const updateFlags = () => {
        const has = includesWord(t.text, p.keyword);
        keyword.textContent = p.keyword.trim() ? (has ? "✓ keyword" : "no keyword") : "";
        keyword.classList.toggle("is-good", has);
      };
      updateFlags();
      input.addEventListener("input", () => { t.text = input.value; count.update(t.text); updateFlags(); save({ soon: true }); refresh(); renderTabs(); });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        p.titles.splice(i + 1, 0, { id: newId("t"), text: "", chosen: false });
        save(); draw();
        list.children[i + 1]?.querySelector("input").focus();
      });
      return el("li", { class: t.chosen ? "is-chosen" : null },
        el("button", { type: "button", class: "pk-star", "aria-pressed": String(!!t.chosen), title: "Use this one",
          "aria-label": `Use ${c.label.toLowerCase()} ${i + 1}`, onclick: () => {
            p.titles.forEach(x => { x.chosen = x === t ? !x.chosen : false; });
            save(); draw(); refresh(); renderTabs();
          } }, t.chosen ? "★" : "☆"),
        input, count.node, keyword,
        el("button", { type: "button", class: "goal-item-remove pk-remove", "aria-label": "Remove", onclick: () => { p.titles.splice(i, 1); save(); draw(); refresh(); } }, "×"));
    }));
    draw();

    const add = (text = "") => {
      p.titles.push({ id: newId("t"), text, chosen: false });
      save(); draw(); refresh();
      list.lastElementChild?.querySelector("input").focus();
    };
    const formulas = el("select", { class: "team-select", "aria-label": "Try a title formula" },
      el("option", { value: "" }, "Try a formula…"), TITLE_FORMULAS.map(f => el("option", { value: f }, f)));
    formulas.addEventListener("change", () => {
      if (!formulas.value) return;
      add(formulas.value.replace("[K]", p.keyword.trim() || "[topic]"));
      formulas.value = "";
    });

    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, c.plural || `${c.label}s`),
        el("span", { class: "pk-hint" }, [c.ideal && `About ${c.ideal} characters show in full`, c.limit && `limit ${c.limit}`].filter(Boolean).join(" · "))),
      list,
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "small-btn", onclick: () => add() }, `+ ${c.label} idea`),
        formulas),
      el("p", { class: "pk-hint" }, "Write lots of options, then ★ the one to use. Enter adds another line."));
  }

  /* ---------- Thumbnail concepts ---------- */
  function thumbsSection(p) {
    const c = config(p).thumb;
    const grid = el("div", { class: "pk-thumbs" });
    const draw = () => grid.replaceChildren(...p.thumbs.map((t, i) => {
      const frame = el("div", { class: "pk-thumb-frame" });
      frame.style.setProperty("--ratio", c.ratio);
      const overlay = el("span", { class: "pk-thumb-text" }, t.text);
      frame.append(overlay);
      imageUrl(t.image).then(url => { if (url) frame.style.backgroundImage = `url("${url}")`; });

      const text = el("input", { value: t.text, placeholder: "Text on the thumbnail (short!)", "aria-label": "Text on the thumbnail" });
      const wc = el("span", { class: "pk-count" });
      const updateWords = () => {
        const n = words(t.text);
        wc.textContent = `${n} word${n === 1 ? "" : "s"}`;
        wc.classList.toggle("is-long", n > 5);
        wc.title = "Thumbnail text reads best at about 5 words or fewer";
      };
      updateWords();
      text.addEventListener("input", () => { t.text = text.value; overlay.textContent = t.text; updateWords(); save({ soon: true }); refresh(); });
      const notes = el("textarea", { rows: "2", placeholder: "The image: who/what, expression, colours, composition", "aria-label": "Thumbnail notes" });
      notes.value = t.notes || "";
      notes.addEventListener("input", () => { t.notes = notes.value; save({ soon: true }); });

      const file = el("input", { type: "file", accept: "image/*", hidden: true });
      file.addEventListener("change", async () => {
        const f = file.files[0];
        file.value = "";
        if (!f) return;
        const id = newId("img");
        try { await FileStore.put(id, f); }
        catch (err) { setStatus(`Couldn't save the image: ${err.message}. Try opening the site from a local server.`); return; }
        const old = t.image;
        t.image = id;
        save(); draw(); refresh();
        await releaseImage(old);
      });

      return el("article", { class: `pk-thumb${t.chosen ? " is-chosen" : ""}` },
        frame,
        el("div", { class: "pk-thumb-row" },
          el("button", { type: "button", class: "pk-star", "aria-pressed": String(!!t.chosen), title: "Use this one", onclick: () => {
            p.thumbs.forEach(x => { x.chosen = x === t ? !x.chosen : false; });
            save(); draw(); refresh();
          } }, t.chosen ? "★" : "☆"),
          text, wc),
        notes,
        el("div", { class: "comment-actions" },
          file,
          el("button", { type: "button", class: "comment-action", onclick: () => file.click() }, t.image ? "Change mock-up" : "Add a mock-up image"),
          t.image && el("button", { type: "button", class: "comment-action", onclick: async () => { const old = t.image; t.image = null; save(); draw(); refresh(); await releaseImage(old); } }, "Remove image"),
          el("button", { type: "button", class: "comment-action", onclick: async () => { p.thumbs.splice(i, 1); save(); draw(); refresh(); await releaseImage(t.image); } }, "Delete")));
    }));
    draw();

    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, c.label || "Thumbnail concepts"),
        el("span", { class: "pk-hint" }, c.size)),
      grid,
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "small-btn", onclick: () => {
          p.thumbs.push({ id: newId("th"), text: "", notes: "", image: null, chosen: !p.thumbs.length });
          save(); draw(); refresh();
          grid.lastElementChild?.querySelector("input").focus();
        } }, "+ Thumbnail concept")),
      el("p", { class: "pk-hint" }, "Sketch ideas in words or add a mock-up (a frame grab, a phone photo, a rough design). The preview shows it at feed size."));
  }

  /* ---------- Description / caption ---------- */
  function descriptionSection(p) {
    const c = config(p);
    const d = c.description;
    const box = el("textarea", { rows: "8", "aria-label": d.label, placeholder: `${d.label}. Put the most important words first: about ${d.fold} characters show before “more”.` });
    box.value = p.description;
    const count = counter(p.description, { limit: d.limit, ideal: null });
    const fold = el("p", { class: "pk-fold" });
    const updateFold = () => {
      const visible = p.description.slice(0, d.fold);
      fold.replaceChildren(el("span", { class: "pk-hint" }, `Shows before “more” (about ${d.fold} characters): `),
        el("span", { class: "pk-fold-text" }, visible || "…"), p.description.length > d.fold ? el("span", { class: "pk-hint" }, " …more") : "");
    };
    updateFold();
    box.addEventListener("input", () => { p.description = box.value; count.update(box.value); updateFold(); save({ soon: true }); refresh(); });

    const insert = (text) => {
      const sep = p.description.trim() ? "\n\n" : "";
      p.description = p.description.replace(/\s+$/, "") + sep + text;
      box.value = p.description;
      count.update(p.description);
      updateFold();
      save(); refresh();
      box.focus();
    };

    // Chapters from a paper edit
    const edits = c.chapters ? editsWithChapters() : [];
    const markerOptions = c.chapters ? markerChapters() : [];
    const chapterMenu = !edits.length && !markerOptions.length ? null : el("select", { class: "team-select", "aria-label": "Add chapters" },
      el("option", { value: "" }, "Add chapters from…"),
      edits.length > 0 && el("optgroup", { label: "Paper edits (sections)" },
        edits.map((e, i) => el("option", { value: `e${i}` }, `${e.edit.name} (${e.chapters.length} chapter${e.chapters.length === 1 ? "" : "s"})`))),
      markerOptions.length > 0 && el("optgroup", { label: "Resolve markers" },
        markerOptions.map((e, i) => el("option", { value: `m${i}` }, `${e.label} (${e.chapters.length})`))));
    chapterMenu?.addEventListener("change", () => {
      const value = chapterMenu.value;
      const e = value[0] === "m" ? markerOptions[Number(value.slice(1))] : edits[Number(value.slice(1))];
      chapterMenu.value = "";
      if (!e) return;
      insert("Chapters\n" + e.chapters.map(ch => `${stamp(ch.at)} ${ch.name}`).join("\n"));
      const tooFew = e.chapters.length < 3, tooShort = e.chapters.some((ch, i) => ((e.chapters[i + 1]?.at ?? e.total) - ch.at) < 10);
      setStatus(tooFew || tooShort ? "Chapters added. YouTube needs at least 3 chapters, each 10 seconds or longer, starting at 00:00." : "Chapters added.");
    });
    const credits = c.credits ? creditsText() : "";

    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, d.label), count.node),
      c.previewText && field(p, "previewText", { label: c.previewText.label, ideal: c.previewText.ideal,
        placeholder: "The line inboxes show after the subject", hint: "Shown next to the subject line in most inboxes." }),
      box, fold,
      el("div", { class: "comment-actions" },
        chapterMenu,
        credits && el("button", { type: "button", class: "small-btn", onclick: () => insert(credits), title: "From the Team page's roles" }, "+ Credits from your team"),
        c.hashtags && el("button", { type: "button", class: "small-btn", onclick: () => {
          if (p.hashtags.length) insert(p.hashtags.map(h => "#" + h).join(" "));
          else setStatus("Add some hashtags below first.");
        } }, "+ Hashtags")),
      c.chapters && !edits.length && !markerOptions.length && el("p", { class: "pk-hint" }, "Chapters can come from a paper edit's sections (Media & Transcripts › Text Edit) or from markers imported from Resolve (Media & Transcripts › Import Resolve markers)."));
  }

  /* ---------- Tags, hashtags ---------- */
  function tagsSection(p) {
    const c = config(p);
    const total = el("span", { class: "pk-count" });
    const updateTotal = () => {
      if (c.tags?.totalLimit) {
        const n = p.tags.join(",").length;
        total.textContent = `${n} / ${c.tags.totalLimit}`;
        total.classList.toggle("is-over", n > c.tags.totalLimit);
      } else if (c.tags?.count) {
        total.textContent = `${p.tags.length} / ${c.tags.count} tags`;
        total.classList.toggle("is-over", p.tags.length > c.tags.count);
      } else total.textContent = `${p.tags.length} tag${p.tags.length === 1 ? "" : "s"}`;
    };
    updateTotal();

    const hashCount = el("span", { class: "pk-count" });
    const updateHash = () => {
      const max = c.hashtags?.max;
      hashCount.textContent = max ? `${p.hashtags.length} / ${max}` : `${p.hashtags.length}`;
      hashCount.classList.toggle("is-over", !!max && p.hashtags.length > max);
    };
    updateHash();

    const suggestions = [p.keyword, ...p.keywords].map(k => k.trim()).filter(k => k && !p.tags.includes(k));
    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, c.tags || c.hashtags ? "Tags and hashtags" : "Tags"), c.tags ? total : null),
      (c.tags || !c.hashtags) && el("div", { class: "pk-field" },
        el("span", { class: "pk-field-head" }, "Tags", c.tags ? null : total),
        chips(p.tags, { placeholder: "Add a tag (Enter or comma)", eachLimit: c.tags?.eachLimit, onChange: () => { updateTotal(); save(); refresh(); } }),
        el("p", { class: "pk-hint" },
          c.tags?.totalLimit ? `YouTube allows ${c.tags.totalLimit} characters of tags in total. Spelling variations and the topic in other words help most.`
          : c.tags?.count ? `Up to ${c.tags.count} tags of ${c.tags.eachLimit} characters each. Use them all: phrases buyers would search for.`
          : "Keywords for your own records, or for platforms that take tags."),
        suggestions.length > 0 && el("p", { class: "pk-hint" }, "From your keywords: ",
          suggestions.map(t => el("button", { type: "button", class: "team-chip team-chip--toggle pk-suggest", onclick: () => { p.tags.push(t); save(); render(); } }, `+ ${t}`)))),
      c.hashtags && el("div", { class: "pk-field" },
        el("span", { class: "pk-field-head" }, "Hashtags", hashCount),
        chips(p.hashtags, { placeholder: "Add a hashtag (no #)", prefix: "#", onChange: () => { updateHash(); save(); refresh(); } }),
        el("p", { class: "pk-hint" }, c.hashtags.shown
          ? `The first ${c.hashtags.shown} show above the title; more than ${c.hashtags.max} and YouTube ignores them all.`
          : `Up to ${c.hashtags.max}. A few specific ones beat many general ones.`)));
  }

  /* A list of chips you type into: Enter or comma adds, Backspace on empty removes the last */
  function chips(list, { placeholder, onChange, prefix = "", eachLimit = null }) {
    const wrap = el("div", { class: "pk-chips" });
    const input = el("input", { placeholder, "aria-label": placeholder });
    const draw = () => {
      wrap.replaceChildren(...list.map((v, i) => el("span", { class: `team-chip pk-chip${eachLimit && v.length > eachLimit ? " is-over" : ""}`,
        title: eachLimit && v.length > eachLimit ? `Longer than ${eachLimit} characters` : null },
        prefix + v,
        el("button", { type: "button", class: "pk-chip-remove", "aria-label": `Remove ${v}`, onclick: () => { list.splice(i, 1); draw(); onChange(); } }, "×"))), input);
    };
    const addFrom = (text) => {
      text.split(/[,\n]/).map(t => t.trim().replace(/^#/, "")).filter(Boolean).forEach(t => { if (!list.includes(t)) list.push(t); });
    };
    input.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === ",") && input.value.trim()) {
        event.preventDefault();
        addFrom(input.value); input.value = "";
        draw(); onChange(); input.focus();
      } else if (event.key === "Backspace" && !input.value && list.length) {
        list.pop(); draw(); onChange(); input.focus();
      }
    });
    input.addEventListener("paste", (event) => {
      const text = event.clipboardData.getData("text/plain");
      if (!/[,\n]/.test(text)) return;
      event.preventDefault();
      addFrom(text); draw(); onChange(); input.focus();
    });
    input.addEventListener("blur", () => { if (input.value.trim()) { addFrom(input.value); input.value = ""; draw(); onChange(); } });
    draw();
    return wrap;
  }

  /* ---------- Alt text ---------- */
  function altSection(p) {
    const list = el("ol", { class: "pk-alts" });
    const draw = () => list.replaceChildren(...p.images.map((img, i) => {
      const label = el("input", { value: img.label, placeholder: "Which image? e.g. Cover, Photo 2, Header image", "aria-label": "Which image" });
      label.addEventListener("input", () => { img.label = label.value; save({ soon: true }); });
      const alt = el("textarea", { rows: "2", placeholder: "Describe what matters in the image for someone who can't see it", "aria-label": `Alt text for ${img.label || `image ${i + 1}`}` });
      alt.value = img.alt;
      const count = counter(img.alt, { ideal: ALT_IDEAL });
      const tip = el("span", { class: "pk-hint pk-alt-tip" });
      const check = () => {
        const a = img.alt.trim();
        tip.textContent = /^(an? )?(image|picture|photo|graphic) of\b/i.test(a) ? "No need to start with “image of”: screen readers already say it's an image."
          : /\.(jpe?g|png|gif|webp)$/i.test(a) ? "That looks like a file name. Describe the image instead."
          : "";
      };
      check();
      alt.addEventListener("input", () => { img.alt = alt.value; count.update(img.alt); check(); save({ soon: true }); refresh(); });
      return el("li", { class: "pk-alt" },
        el("div", { class: "pk-thumb-row" }, label, count.node,
          el("button", { type: "button", class: "goal-item-remove pk-remove", "aria-label": "Remove image", onclick: () => { p.images.splice(i, 1); save(); draw(); refresh(); } }, "×")),
        alt, tip);
    }));
    draw();
    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, "Alt text"), el("span", { class: "pk-hint" }, `About ${ALT_IDEAL} characters or fewer`)),
      list,
      el("button", { type: "button", class: "small-btn", onclick: () => {
        p.images.push({ id: newId("a"), label: p.images.length ? `Image ${p.images.length + 1}` : (p.platform === "zine" ? "Cover" : "Image 1"), alt: "" });
        save(); draw(); refresh();
        list.lastElementChild?.querySelector("textarea").focus();
      } }, "+ Image"),
      el("p", { class: "pk-hint" }, "Say what the image shows and why it's there: people, action, text in the image. Skip “image of”."));
  }

  /* ---------- Web SEO ---------- */
  function seoSection(p) {
    const slugBox = field(p, "slug", { label: "Link (URL slug)", placeholder: slugify(chosenTitle(p)) || "short-words-with-hyphens",
      hint: "Short, lower case, words separated by hyphens. Leave empty to use the title." });
    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, "Search and sharing")),
      field(p, "seoTitle", { label: "SEO title (search results)", ideal: 60, placeholder: chosenTitle(p) || "Defaults to your chosen title",
        hint: "About 60 characters show in Google before it's cut off." }),
      field(p, "metaDescription", { label: "Meta description", textarea: true, rows: 2, ideal: 160,
        placeholder: "One or two sentences that make someone click", hint: "About 150–160 characters show in search results." }),
      slugBox,
      el("div", { class: "zine-form-row" },
        field(p, "shareTitle", { label: "Social share title", ideal: 70, placeholder: "Defaults to the SEO title" }),
        field(p, "shareDescription", { label: "Social share description", ideal: 120, placeholder: "Defaults to the meta description" })));
  }

  /* ---------- Deliverables ---------- */
  function deliverablesSection(p) {
    const items = DELIVERABLES[p.platform] || DELIVERABLES.other;
    const d = p.deliverables;
    const list = el("ul", { class: "pk-deliverables" });
    const draw = () => list.replaceChildren(
      ...items.map(item => {
        const box = el("input", { type: "checkbox", checked: !!d.done[item.id] });
        box.addEventListener("change", () => { if (box.checked) d.done[item.id] = true; else delete d.done[item.id]; save(); refresh(); });
        return el("li", {}, el("label", { class: "pk-deliverable" }, box,
          el("span", {}, el("span", { class: "pk-deliverable-label" }, item.label), item.detail && el("span", { class: "pk-hint" }, item.detail))));
      }),
      ...d.custom.map((item, i) => {
        const box = el("input", { type: "checkbox", checked: !!item.done, "aria-label": `Done: ${item.text || "item"}` });
        box.addEventListener("change", () => { item.done = box.checked; save(); refresh(); });
        const text = el("input", { value: item.text, "aria-label": "Deliverable", placeholder: "e.g. Festival screener (ProRes 422 HQ)" });
        text.addEventListener("input", () => { item.text = text.value; save({ soon: true }); });
        return el("li", { class: "pk-deliverable pk-deliverable--custom" }, box, text,
          el("button", { type: "button", class: "goal-item-remove pk-remove", "aria-label": "Remove", onclick: () => { d.custom.splice(i, 1); save(); draw(); refresh(); } }, "×"));
      }));
    draw();
    const asText = () => [`Deliverables: ${p.name || config(p).name}`, "",
      ...items.map(i => `${d.done[i.id] ? "[x]" : "[ ]"} ${i.label}${i.detail ? `\n    ${i.detail}` : ""}`),
      ...d.custom.filter(i => i.text.trim()).map(i => `${i.done ? "[x]" : "[ ]"} ${i.text}`)].join("\n");
    return el("section", { class: "pk-card" },
      el("div", { class: "pk-card-head" }, el("h2", {}, "Deliverables"), el("span", { class: "pk-hint" }, "With the settings in DaVinci Resolve")),
      list,
      el("div", { class: "comment-actions" },
        el("button", { type: "button", class: "small-btn", onclick: () => {
          d.custom.push({ id: newId("d"), text: "", done: false });
          save(); draw();
          list.lastElementChild?.querySelector("input:not([type])")?.focus();
        } }, "+ Deliverable"),
        el("button", { type: "button", class: "small-btn", onclick: () => copy(asText(), "Deliverables") }, "Copy as a checklist")),
      el("p", { class: "pk-hint" }, "Tip: once a render is set up in Resolve's Deliver page, save it as a preset (⋯ › Save As New Preset) and export it (⋯ › Export Preset) to share with everyone you edit with."));
  }

  /* ---------- Export ---------- */
  function exportText(p) {
    const c = config(p);
    const lines = [`${config(p).name}${p.name ? `: ${p.name}` : ""}`, ""];
    const add = (label, value) => { if (String(value || "").trim()) lines.push(`${label}:`, String(value).trim(), ""); };
    add(c.title?.label || "Title", chosenTitle(p));
    if (c.previewText) add(c.previewText.label, p.previewText);
    add(c.description.label, p.description);
    if (p.tags.length) add("Tags", p.tags.join(", "));
    if (c.hashtags && p.hashtags.length) add("Hashtags", p.hashtags.map(h => "#" + h).join(" "));
    const thumb = p.thumbs.find(t => t.chosen) || p.thumbs[0];
    if (thumb) add("Thumbnail", [thumb.text && `Text: ${thumb.text}`, thumb.notes].filter(Boolean).join("\n"));
    p.images.filter(i => i.alt.trim()).forEach(i => add(`Alt text (${i.label || "image"})`, i.alt));
    if (c.seo) {
      add("SEO title", p.seoTitle || chosenTitle(p));
      add("Meta description", p.metaDescription);
      add("URL slug", p.slug || slugify(chosenTitle(p)));
      add("Social share title", p.shareTitle);
      add("Social share description", p.shareDescription);
    }
    add("Keywords", [p.keyword, ...p.keywords].filter(Boolean).join(", "));
    const others = p.titles.filter(t => t.text.trim() && t !== p.titles.find(x => x.chosen)).map(t => `- ${t.text}`);
    if (others.length) add("Other title ideas", others.join("\n"));
    return lines.join("\n");
  }

  function exportSection(p) {
    const c = config(p);
    return el("section", { class: "pk-card" },
      el("h2", {}, "Copy and export"),
      el("div", { class: "pk-export" },
        c.title && el("button", { type: "button", class: "small-btn", onclick: () => copy(chosenTitle(p), c.title.label) }, `Copy ${c.title.label.toLowerCase()}`),
        el("button", { type: "button", class: "small-btn", onclick: () => copy(p.description, c.description.label) }, `Copy ${c.description.label.toLowerCase()}`),
        p.tags.length > 0 && el("button", { type: "button", class: "small-btn", onclick: () => copy(p.tags.join(", "), "Tags") }, "Copy tags"),
        p.hashtags.length > 0 && el("button", { type: "button", class: "small-btn", onclick: () => copy(p.hashtags.map(h => "#" + h).join(" "), "Hashtags") }, "Copy hashtags"),
        el("button", { type: "button", class: "small-btn", onclick: () => copy(exportText(p), "Everything") }, "Copy everything"),
        el("button", { type: "button", class: "small-btn", onclick: () => download(exportText(p), `${slugify(p.name || chosenTitle(p) || "package")}-packaging.txt`) }, "Download (.txt)")));
  }


  /* =========================================================
     PREVIEW AND CHECKLIST
     ========================================================= */

  async function renderPreview(p) {
    const box = $("pk-preview");
    if (!box) return;
    const c = config(p);
    const title = chosenTitle(p);
    const thumb = p.thumbs.find(t => t.chosen) || p.thumbs[0];

    // Search-result style preview for web pages and listings
    if (c.seo) {
      const seoTitle = p.seoTitle || title || "Your SEO title";
      const meta = p.metaDescription || p.description || "Your meta description appears here.";
      box.replaceChildren(el("div", { class: "pk-serp" },
        el("p", { class: "pk-serp-url" }, `yoursite.com › ${p.slug || slugify(title) || "page"}`),
        el("p", { class: "pk-serp-title" }, cut(seoTitle, 60)),
        el("p", { class: "pk-serp-desc" }, cut(meta, 160))),
        el("p", { class: "pk-hint" }, "Roughly how it looks in search results."));
    } else box.replaceChildren();

    // Feed-style preview with the thumbnail
    if (c.thumb) {
      const frame = el("div", { class: "pk-feed-thumb" }, el("span", { class: "pk-thumb-text" }, thumb?.text || ""));
      frame.style.setProperty("--ratio", c.thumb.ratio);
      if (p.platform === "youtube") {
        const edits = editsWithChapters();
        if (edits[0]) frame.append(el("span", { class: "pk-duration" }, stamp(edits[0].total)));
      }
      const url = await imageUrl(thumb?.image);
      if (url) frame.style.backgroundImage = `url("${url}")`;
      const card = el("div", { class: `pk-feed pk-feed--${p.platform}` },
        frame,
        el("div", { class: "pk-feed-meta" },
          c.title && el("p", { class: "pk-feed-title" }, cut(title || `Your ${c.title.label.toLowerCase()}`, c.title.ideal + 10)),
          !c.title && el("p", { class: "pk-feed-title" }, cut(p.description || "Your caption", c.description.fold)),
          el("p", { class: "pk-feed-sub" }, Projects.activeName())));
      const small = card.cloneNode(true);
      small.classList.add("is-small");
      box.append(el("p", { class: "pk-hint" }, "In a feed:"), card, el("p", { class: "pk-hint" }, "Small (phone, sidebar):"), small);
    } else if (c.previewText) {
      box.append(el("div", { class: "pk-inbox" },
        el("p", { class: "pk-inbox-from" }, Projects.activeName()),
        el("p", { class: "pk-inbox-subject" }, cut(title || "Your subject line", 60)),
        el("p", { class: "pk-inbox-preview" }, cut(p.previewText || p.description || "Your preview text", 90))),
        el("p", { class: "pk-hint" }, "Roughly how it looks in an inbox."));
    }
  }

  function checksFor(p) {
    const c = config(p);
    const K = p.keyword.trim();
    const title = chosenTitle(p);
    const checks = [];
    const add = (ok, text, tip = "") => checks.push({ ok, text, tip });

    if (c.title) {
      add(!!title, `${c.title.label} chosen`, "★ one of your ideas.");
      if (title) add(title.length <= (c.title.limit || Infinity), `${c.title.label} within the limit`);
      if (title && c.title.ideal) add(title.length <= c.title.ideal, `${c.title.label} short enough to show in full (about ${c.title.ideal})`);
      if (K) add(includesWord(title, K), "Primary keyword in the title");
    }
    if (c.previewText) add(!!p.previewText.trim(), "Preview text written");
    add(p.description.trim().length > 0, `${c.description.label} written`);
    if (c.description.limit) add(p.description.length <= c.description.limit, `${c.description.label} within ${c.description.limit} characters`);
    if (K && p.description) add(includesWord(p.description.slice(0, c.description.fold), K), `Keyword in the first ${c.description.fold} characters (before “more”)`);
    if (p.platform === "youtube") {
      const stamps = p.description.match(/^\s*(\d{1,2}:)?\d{1,2}:\d{2}\b/gm) || [];
      if (stamps.length) add(stamps.length >= 3 && /^\s*0?0:00\b/.test(stamps[0]), "Chapters start at 00:00, with at least 3", "YouTube only shows chapters that start at 00:00, with 3 or more of at least 10 seconds.");
      else add(false, "Chapters in the description", "Optional, but they help people and search. Add them from your paper edit.");
    }
    if (c.tags?.totalLimit) add(p.tags.length > 0 && p.tags.join(",").length <= c.tags.totalLimit, `Tags added, within ${c.tags.totalLimit} characters`);
    if (c.tags?.count) add(p.tags.length === c.tags.count && p.tags.every(t => t.length <= c.tags.eachLimit), `All ${c.tags.count} tags used, each ${c.tags.eachLimit} characters or fewer`);
    if (c.tags && K) add(p.tags.some(t => includesWord(t, K) || includesWord(K, t)), "Primary keyword among the tags");
    if (c.hashtags) add(p.hashtags.length > 0 && p.hashtags.length <= c.hashtags.max, `1–${c.hashtags.max} hashtags`);
    if (c.thumb) {
      const t = p.thumbs.find(x => x.chosen);
      add(!!t, "Thumbnail concept chosen", "★ a concept.");
      if (t) add(words(t.text) <= 5, "Thumbnail text 5 words or fewer");
    }
    if (c.alt) {
      add(p.images.length > 0 && p.images.every(i => i.alt.trim()), "Alt text for every image");
      if (p.images.some(i => i.alt.trim())) add(p.images.every(i => i.alt.length <= ALT_IDEAL + 25), `Alt text concise (about ${ALT_IDEAL} characters)`);
    }
    if (c.seo) {
      const seoTitle = p.seoTitle || title;
      add(!!seoTitle && seoTitle.length <= 60, "SEO title 60 characters or fewer");
      add(p.metaDescription.length >= 70 && p.metaDescription.length <= 160, "Meta description 70–160 characters");
      if (K) add(includesWord(seoTitle, K) || includesWord(p.metaDescription, K), "Keyword in the SEO title or meta description");
    }
    const deliverables = (DELIVERABLES[p.platform] || DELIVERABLES.other).map(i => !!p.deliverables.done[i.id])
      .concat(p.deliverables.custom.filter(i => i.text.trim()).map(i => !!i.done));
    add(deliverables.every(Boolean), `Deliverables ready (${deliverables.filter(Boolean).length} of ${deliverables.length})`);
    if (!K) add(false, "Primary keyword set", "Pick the phrase people would search for (The basics).");
    return checks;
  }

  function renderChecks(p) {
    const box = $("pk-checks");
    if (!box) return;
    const checks = checksFor(p);
    const done = checks.filter(c => c.ok).length;
    box.replaceChildren(
      el("li", { class: "pk-score" }, `${done} of ${checks.length} done`),
      ...checks.map(c => el("li", { class: c.ok ? "is-ok" : "is-todo", title: c.tip || null },
        el("span", { class: "pk-check-icon", "aria-hidden": "true" }, c.ok ? "✓" : "○"),
        el("span", {}, c.text, !c.ok && c.tip && el("span", { class: "pk-hint" }, ` ${c.tip}`)))));
  }


  /* =========================================================
     PACKAGES: new, duplicate, delete
     ========================================================= */

  function duplicatePackage(p) {
    const copy = JSON.parse(JSON.stringify(p));
    Object.assign(copy, { id: newId("pk"), name: `${p.name || config(p).name} (copy)`, created: Date.now(), updated: Date.now() });
    packages.push(copy);
    save();
    select(copy.id);
  }

  async function deletePackage(p) {
    if (!confirm(`Delete the package “${p.name || config(p).name}”?`)) return;
    packages = packages.filter(x => x !== p);
    currentId = packages[0]?.id || null;
    save();
    render();
    for (const t of p.thumbs) await releaseImage(t.image);
  }

  /* New packages: one or several platforms. Several made at once (or from one
     pitch) become one story, sharing keywords and audience. */
  function setUpDialog() {
    const dialog = $("pk-dialog");
    $("pk-platforms").append(...Object.entries(PLATFORMS).map(([id, c]) =>
      el("label", { class: "zine-preset" },
        el("input", { type: "checkbox", name: "platform", value: id }),
        el("span", { class: "zine-preset-name" }, c.name),
        el("span", { class: "zine-preset-note" }, c.note))));

    const pitchList = () => { const v = Projects.getData("pitches", []); return Array.isArray(v) ? v : []; };
    const open = (pitchId = "", platforms = ["youtube"]) => {
      $("pk-form").reset();
      const pitches = pitchList();
      $("pk-pitch").replaceChildren(el("option", { value: "" }, pitches.length ? "No, start blank" : "No pitches in this project yet"),
        ...pitches.map(x => el("option", { value: x.id }, x.title || "Untitled pitch")));
      $("pk-pitch").value = pitches.some(x => x.id === pitchId) ? pitchId : "";
      $("pk-pitch").disabled = !pitches.length;
      $("pk-platforms").querySelectorAll("input").forEach(box => { box.checked = platforms.includes(box.value); });
      dialog.showModal();
    };
    $("pk-new").addEventListener("click", () => open());
    if (window.DocExport) $("pk-new").after(DocExport.buttons({ blocks: exportBlocks, title: `Package: ${current()?.name || ""}`, filename: `${Cobbler.slug(current()?.name || "package")}-package`, label: "Export this package" }));
    $("pk-cancel").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });

    $("pk-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.target);
      const platforms = data.getAll("platform").map(String);
      if (!platforms.length) { alert("Pick at least one place it's going."); return; }
      const name = String(data.get("name") || "").trim();
      const pitch = pitchList().find(x => x.id === data.get("pitchId")) || null;

      // Join an existing story for this pitch (reusing its keywords), or start one
      const earlier = pitch ? packages.find(x => x.pitchId === pitch.id && x.storyId) : null;
      const storyId = earlier?.storyId || (platforms.length > 1 || pitch ? newId("s") : null);
      const tracker = Projects.getData("tracker", {}) || {};
      const taxonomy = String(tracker.taxonomy || "").split(",").map(t => t.trim()).filter(Boolean);

      const made = platforms.map(platform => {
        const titles = [pitch?.title, Projects.activeName()].filter((t, i, all) => t && all.indexOf(t) === i);
        return {
          id: newId("pk"), name, platform,
          keyword: earlier?.keyword || "", keywords: earlier ? [...earlier.keywords] : (pitch ? taxonomy : []),
          audience: earlier?.audience || pitch?.audience || "", notes: "",
          titles: titles.map(text => ({ id: newId("t"), text, chosen: false })),
          thumbs: [], description: pitch?.hook || "", tags: [], hashtags: [],
          images: PLATFORMS[platform].alt ? [{ id: newId("a"), label: platform === "zine" ? "Cover" : "Image 1", alt: "" }] : [],
          seoTitle: "", metaDescription: "", slug: "", shareTitle: "", shareDescription: "", previewText: "",
          deliverables: { done: {}, custom: [] },
          ...(storyId ? { storyId } : {}), ...(pitch ? { pitchId: pitch.id } : {}),
          created: Date.now(), updated: Date.now(),
        };
      });
      packages.push(...made);
      save();
      dialog.close();
      select(made[0].id);
      if (made.length > 1 || earlier) setStatus(`Made ${made.length} package${made.length === 1 ? "" : "s"} for one story: their keywords and audience stay the same as you edit any of them.`);
    });

    // Pitches page › "Package it" opens packaging.html#from-pitch=<id>
    const fromPitch = location.hash.match(/^#from-pitch=(.+)$/);
    if (fromPitch) {
      history.replaceState(null, "", location.pathname);
      open(decodeURIComponent(fromPitch[1]), ["youtube", "article", "zine"]);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    setUpDialog();
    render();
  });

  // After an undo, or when changes arrive from elsewhere: draw the page again from what's stored
  document.addEventListener("projects-refresh", (event) => {
    clearTimeout(saveTimer);
    if (event.detail.reason === "switch") currentId = remembered();   // another project: its own open package
    loadData();
    render();
    event.detail.handled = true;
  });
  // Transcripts kept outside the project finished loading (media-core.js): the previews may change
  document.addEventListener("transcripts-loaded", () => { if (current()) refresh(); });
})();
