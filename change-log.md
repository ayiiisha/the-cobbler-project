**11 October 2026 (exports everywhere, sheet switching, chart axes, zine pages, placing notes)**

* PDF and Word exports on Ideas, Research, Pitches, Packaging (the open package), Interviews, Team (with tasks), Resources and Data Analysis (profile, filters and rows), through a shared pair of buttons (DocExport.buttons)
* Data Analysis: the Excel workbook is kept, so a Sheet drop-down switches sheets later; the Rows section is paged (page number and rows per page); the chart controls name the axes explicitly for every chart type, with ⇄ Swap axes (a bar chart turns sideways; the R code follows with coord_flip())
* Zine Planner: pages can be added or removed one, two or four at a time (and a new zine can have any count from 2); a note says how many blank pages a folded booklet would add at print time
* Music: notes and rests are placed by clicking on the staff after picking a tool (note or rest), a length (whole to sixteenth, dotted) and an accidental; clicking a note selects it for ↑ ↓, a new length or Delete. The ABC text stays underneath for typing, and the score sits above it
* Checks: the page runner now fails on an empty or truncated page (one was caught during this work)

**11 October 2026 (shot list with storyboard frames, tutorial tour, first week)**

* Shot List: a Frame column shows each shot's storyboard drawing; click it or “Link frame” to pick a frame from any storyboard (filling in size, movement, scene and seconds where empty). A Board view shows every shot as a card with its frame, reorderable, and prints as a storyboard sheet
* Tutorial: a guided tour of every page (Home › Take the tour, or Settings › Tutorial): a spotlight and a card on each stop, Next/Back/Esc, continues across pages and after a break
* User guide: a “Your first week” section at the top, in the order a project actually unfolds
* Edits made straight on GitHub (a CSV, a line of text) used to leave the offline copy's version stale; a CI job on main now bumps it and commits
* Dark, rainbow and print pass on the newer pages: shot list, call sheet, search results, ideas panel, Settings panels and the tour; the shot list prints as a clean table or sheet, with panels and buttons off the paper

**10 October 2026 (backups, search, phones, accessibility, checks)**

* Backups: Settings › Backups can back up every project automatically to a folder you choose (Chrome, Edge), every day or week, keeping the newest few; the first backup is written at once. Without it, a note once a day reminds you when there's work not backed up for a week. The app also asks the browser, once there's real work, to keep this site's data when the disk runs low (backups.js)
* Search across the project: a box in the sidebar (Ctrl/⌘+K) searches everything in the active project, grouped by page, with links straight to lists, storyboards and zines (search.js)
* Settings › This browser lists what the browser can and can't do; the guide says which browsers work best
* Phones and tablets: the round buttons line up along the bottom instead of covering the right edge; the shot list becomes a stack of cards
* Accessibility: the transcript search box has a label; the Research, Pitches and Team pages have a heading before their cards; the Storyboarder's print sheet shared an id with the Print button, so printing a storyboard built the sheet inside the button (fixed)
* Checks: the test tooling's versions are pinned; `npm run version:write` keeps the offline copy's version and file list in step with the files and CI fails when it's stale; end-to-end flows (tests/flows.mjs) cover saving and reloading, undo in place, project switching, the shot list, the ideas panel, search, an Excel import and a transcript import; every page is checked for named buttons, labelled fields, alt text and unique ids

**10 October 2026 (bug fixes)**

* Offline copy: the service worker refreshed its files through the browser's ordinary cache, so a fresh copy could be replaced by one the browser still had from before a deploy (GitHub Pages keeps files for 10 minutes). It now always checks with the server
* Undo: different changes made within a moment of each other (an import, then Sort by scene) were undone together, because saves within 1.5 seconds were treated as typing. Only saves that look like typing (the same items, different text) are one step now
* Data Analysis: Excel cells written without a cell reference (some apps leave it out) were skipped; they're placed along the row instead
* Self-tests: one more, one extended (40 in all)

**10 October 2026 (call sheets, scheduling exports, Excel import, switching in place)**

* Shot List: a call sheet (PDF or Word) for each list: call and wrap time, location, access and parking, weather and nearest hospital (new fields under Details), notes, the crew from the Team page with contacts, the people from the Interviews page booked for that date, and a schedule with each shot's start time from the call time and its minutes
* Shot List: a CSV laid out for scheduling apps (scene number and shot letter in their own columns, StudioBinder/Shot Lister-style headings) and a calendar file (.ics) with the shoot day and a block per timed shot
* Data Analysis: loads Excel files (.xlsx) as well as CSV, with a sheet picker for workbooks that have several; dates, numbers and TRUE/FALSE come through as from "Save as CSV". The R code uses readxl::read_excel() for them (xlsx-read.js, no library: the browser unzips the file itself)
* Switching projects (the Projects panel, the Project Tracker, the Projects page), making a new project and restoring a backup redraw the page in place instead of reloading it; pages that remember an open item per project pick up the other project's
* Code: date and time formatting and drag-to-reorder are shared helpers in util.js (Cobbler.formatDate, formatTime, dragReorder); the Interviews, Ideas, Storyboarder, Research, Zine Planner and Shot List pages use them
* 3 new self-tests (shot list exports, the shared helpers, Excel files), 39 in all

**10 October 2026 (shot lists, ideas on every page)**

* New page, Shot List: shot lists for a shoot (one per day, scene or location) with the shoot date, call time, location and notes. Each shot has scene, size, angle, movement, lens, subject and action, INT/EXT, day/night, seconds on screen, minutes to shoot, gear, sound, notes and a box to tick on set. Shots are numbered from scene and order (12A, 12B…); drag or ↑ ↓ to reorder, Sort by scene, Hide done. Shots can be added from a storyboard's frames (with a link back to each frame) or one per scene heading of the screenplay. CSV and a PDF for the set; the project details document includes the lists; shoot days show on the Calendar (shot-list.js, shot-list.html)
* Ideas on every page: a lightbulb button above the person button opens the project's ideas in a panel on the right. Jot, edit, move (← →) or delete cards there; the panel stays open from page to page until it's closed (ideas-panel.js)
* 2 new self-tests for the shot list helpers (36 in all)

**10 October 2026 (database, offline, in-place undo, checks)**

* Projects now live in the browser's database (IndexedDB) instead of localStorage, so the old 5 MB limit is gone. Existing projects are moved across on first load. Only the projects that changed are written; tabs tell each other about saves and swap the new data in
* Undo and redo redraw the page in place instead of reloading it: every page re-reads its data on a "projects-refresh" event. Changes arriving from a sync folder, or saved in another tab, show the same way (while you're typing, the next thing you do shows them). Saving a page's own defaults no longer counts as a step to undo
* Offline and install: a service worker (sw.js) keeps a copy of the app once it's been opened online, and a web app manifest lets Chrome and Edge install it. A note offers to reload when a new version is published
* Checks run on every push (GitHub Actions): ESLint and the self-tests page, plus every page opened in a headless browser. `npm run lint` and `npm test` run the same locally
* The repeated page helpers (el, $, newId, slug, download, …) are shared from util.js; page scripts load through boot.js once the projects have been read
* Settings › Storage shows the database's usage with the browser's own estimate; the storage warning uses it too
* Self-tests: 3 new tests for the database (34 in all). Music and Writing tabs name the panel they control (aria-controls); the A/V Script and Packaging pages refresh when transcripts kept elsewhere finish loading; unused code removed

**10 October 2026 (bug fixes)**

* Saving: a page that edits the stored list in place but saves a tidied copy (e.g. Ideas, which never saves empty cards) could be merged with itself and bring back what it had just removed. Only changes that actually arrived from elsewhere (a collaborator, another tab, an undo) trigger a merge now
* Ideas: clicking "+ Add idea" (or anything else) while an empty card was open did nothing the first time, because the empty card's disappearance redrew the board under the click. Empty cards now slip out on their own
* Loading: if the saved record of which project is active ever pointed at a project that no longer existed, the app started over with a fresh project and saved it on top of the others. The projects are kept and the first one becomes active (projects-core.js)
* Screenplay: the shortcut hints always said Ctrl+1–7, even on a Mac, because a function in the page was named `navigator` and hid the browser's own. Renamed
* Zine Planner: opening a zine or switching tabs drew the page twice (once directly, once for the address change)
* Packaging: "Copy everything" and the .txt download put an "undefined:" line in packages that had preview text but weren't newsletters
* Team › Tasks: choosing your name under "I am" now signs you in the same way as the person button, so the button, comments and the dashboard update at once
* Pitches: "Copy email" is signed with the name you signed in with (it only looked at the old comments name)
* Writing › Check: the quote checker re-checks once transcripts kept outside the project have finished loading
* The sidebar's page links are a proper list (ul), as HTML requires; every page has the logo as its tab icon, so browsers stop asking for a missing favicon.ico
* Code: 2 new self-tests (31 in all); comments.js and dashboard.js tolerate oddly shaped saved data

**10 October 2026 (default resources)**

* The default resources CSV now sits at the top of the app (default-resources-cobbler-project.csv, next to index.html), so it can be replaced on GitHub by uploading a file with the same name. Its old place, resources/data/, still works
* Its header can also say Title, URL, Notes and similar; the app ZIP rebuilds the copy for double-clicked pages from the current CSV; update-resources.sh writes that copy safely whatever the CSV contains

**10 October 2026 (storage: compression, transcripts elsewhere, housekeeping)**

* Saved projects are compressed (lz-string) once they're big: usually 3 to 5 times smaller. Projects now live under the storage key cobblerProjects2 (moved automatically), and saved data that can't be read is never overwritten
* Transcripts can be kept in this browser's file storage or as files in a folder you choose (e.g. a shared Google Drive folder, or your sync folder), instead of inside the project. Each transcript shows where it's stored, logs every move (when, who, where) and the project report lists it; Move all moves every transcript at once. Shares and sync carry moved transcripts; if the browser's copy is gone, the folder copy is read
* Settings › Storage › Housekeeping: how much compression saves, which projects still keep transcripts inside, Back up and remove for archived projects, Find unused files
* Code: vendored lz-string 1.5.0 (resources/vendor/lz-string, in the app ZIP with its licence); media-core.js (hydrate, packMedia, moveTranscript), media.js, settings.js, report.js, projects-core.js; 6 new self-tests (29 in all)

**10 October 2026 (signing in)**

* Person button on every page, above the comments and "+" buttons: sign in with your name, change it or sign out. Shows your initial when signed in. The first-visit prompt now lives here, so clicking "Not now" no longer leaves you without a way to sign in (account.js; removed from sync.js)
* Home: a "New here?" callout with a button to the tutorial (PDF); the "For you" card offers Sign in
* Tutorial updated: signing in, the person button, where your name is used

**10 October 2026 (undo, storage, screenplays, collaboration, connections)**

* Undo and redo everywhere: Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (or Ctrl+Y) undo and redo your recent changes on any page, up to 60 steps per tab; typing in a box keeps its own undo. A note offers Redo/Undo. Undo never discards changes that arrived from collaborators (undo.js; steps kept in projects-core.js)
* Settings › Storage: how full browser storage is, per project and part, file storage, Trim old history, Keep my files safe; a warning on any page at 80%
* Self-tests page (Settings › Run the app's self-tests): 23 checks of merging, sync, undo, read-only copies, transcripts, markers, screenplay pages, Fountain/Final Draft, music keys and the share report, in a sandbox that never touches your projects
* Screenplay
  * Revisions in the industry's colours (Blue, Pink, Yellow…): changes marked * in the margin, revision and date at the top of changed pages, listed on the title page, optional coloured pages, Clear marks
  * Dual dialogue: two speeches side by side (in pages, PDF, Final Draft and Fountain)
  * Breakdown: scenes with eighths of a page, cast, and tagged props, wardrobe, makeup, extras, vehicles, stunts, effects, sound, music, animals, set dressing, notes; tag selected words, suggestions from CAPITALS; order by location or time; breakdown sheets (PDF), CSV, shooting order (PDF)
  * Make a storyboard (a shot per scene) and make an A/V script (a paper edit) from the script
* Collaboration
  * Share a full copy, by email, or a read-only copy for feedback (comments only; "Send my comments back"; their comments merge into your project and nothing else)
  * Differences settled automatically: listed on the Projects page, switchable to the other version
  * Lock a version (kept in this browser; syncing never changes it); open as a new project or download
  * Asks your name on first visit
* Connections
  * Home: a dashboard of what's due (and overdue), what's assigned to you, what's in progress and recent activity
  * Writing › Package this: starts a package from a draft
  * Music › Package the video: YouTube and Shorts packages for a release
  * Writing › Reporting: link sources to their interview and transcripts; the quote checker checks attributed quotes against the speaker's own transcripts and warns when a quote matches someone else's
* Fixes: the Home page's tab title said "About"; Zine Planner tabs clicked with no zine open; a merge-review error after the feedback change
* Code: undo.js, dashboard.js, tests.js, tests.html; projects-core.js (undo steps, storage info, read-only, paths), share.js (read-only, feedback, locks), sync.js, screenplay.js, calendar.js (CobblerCalendar); style.css sections 35–36

**9 October 2026 (bug fixes)**

* Collaboration (projects-core.js)
  * Moving something between lists (e.g. a scene to another chapter) was recorded as a deletion, so the next merge or sync removed it everywhere. Moves are now kept, and show in Activity as a change
  * Deleting a page's last comment wasn't recorded, so the comment could come back from a collaborator's copy
  * A second script reading the same data (e.g. the Comments drawer reading the team) could hide changes that had just arrived, so the page's next save overwrote them. Only a page's first read and its own saves count now
  * Pages that edit stored data in place, after collaborators' changes arrived, stamped those changes with your name and a new time. They're now compared with what's actually stored
* Writing: words that arrived from collaborators no longer count towards your daily goal; "1 words" → "1 word"
* Screenplay: Tab on an empty scene heading changes its type (it used to type "INT. ")
* Writing and Music: the tab bars scroll sideways on phones instead of widening the page

**9 October 2026 (screenplays)**

* Screenplay page (new): write in standard Hollywood format in Courier New
  * Scene headings, action, characters, parentheticals, dialogue, transitions and shots, each at its standard margin
  * Final Draft-style keys (Enter for the next element, Tab to change type or finish a name or location, Cmd/Ctrl+1–7), smart action lines (INT./EXT., character names, transitions)
  * Scene and character lists, page count (about a page a minute)
  * Pages view laid out exactly as printed: 54 lines a page, page numbers, (MORE)/(CONT'D), no scene headings or names stranded, optional scene numbers and title page
  * Export as PDF, Final Draft (.fdx) or Fountain; import Fountain
* Music › Sheet music: the note buttons follow the key signature (e.g. D♭ E♭ F G♭ A♭ B♭ C in D♭ major), with the key note highlighted
* Writing: read aloud removed
* Project details export includes screenplays (scene lists)

**9 October 2026 (collaboration, writing, music)**

* Ready for GitHub Pages: index.html at the top (sends visitors to pages/index.html), .gitignore (no backups, shared files or calendars in the repository), .nojekyll. Steps in the code guide. Project data never goes online
* Sync folder (Projects page): choose a shared folder (e.g. a shared Google Drive folder through Google Drive for desktop) and tick the projects to sync. Each person writes only their own file there; the app merges everyone else's every 30 seconds and after changes. Collaborators' projects in the folder can be joined. Sync status in the sidebar (click to reconnect). Chrome or Edge; Share and Import still work everywhere
* Smarter merging, used by Share/Import, the sync folder and saving
  * Every change is stamped with who and when; deletions are recorded so they reach collaborators; one-sided changes are taken without asking; the newer change wins where you both changed something (you can still choose on Import)
  * A page whose data changed underneath it (changes arrived from the folder or another tab) merges its own changes in instead of overwriting
  * Activity feed (Projects page): who added, changed or deleted what
  * Undo last merge on each project card
  * Claim: "I'm working on this" on drafts, songs, paper edits and packages
* Projects cards: Email (attaches the shared file where the browser can, otherwise downloads it and opens an email to the team) and Changes since last share (net changes, by page)
* Share reminder: after 5 days (changeable, or off) for shared projects that changed since
* Writing page (new)
  * Draft: binder of parts/chapters and sections/scenes, whole-draft writing view, scene inspector (status, synopsis, POV, setting, story time, plot threads, notes, story-bible mentions), corkboard, read aloud, versions; templates (inverted pyramid, feature, explainer, profile, investigation, essay, nonfiction book, three acts, Save the Cat, Hero's Journey, kishōtenketsu, short story)
  * Export: standard manuscript format (.docx), document (.docx/PDF), Markdown, text
  * Check: fact-check claims linked to Research, quote checker against transcripts, style and readability (Flesch, grade level, passive voice, adverbs, clichés, banned words, AP or Chicago rules, fiction dialogue checks)
  * Story: story bible, plot-thread grid with dropped-thread warnings, story timeline
  * Reporting: sources (attribution, agreements, anonymity approval, contact log), records requests with legal deadlines, event timeline (PDF/Word/CSV)
  * Revisions: versions with tracked changes and editor notes, restore as new draft, beta-reader/editor feedback, revision passes, legal and ethics checklist, corrections log
  * Business: submissions, agent queries, fees, kill fees, rights, invoices (PDF/.docx); Goals: daily word goal, streak, 30-day chart
* Music page (new)
  * Song sketchbook: lyrics with chords above (transpose up/down), sheet music in ABC notation with a note palette and playback (abcjs, in resources/vendor), split sheets (shares must total 100%, PROs, IPI, signed), sessions, versions with audio and time-stamped notes; export sheet music and/or lyrics, or the split sheet, as PDF
  * Gigs and bookings: status, deal, fee, times, setlist from songs, advance email, printable setlist, payments
  * Releases: plan worked back from the release date, ISRCs, warnings for uncleared samples and unsigned splits
  * Sample clearances: recording and song owners, status, terms, agreements
* Calendar: writing deadlines, embargoes, records-request deadlines, gigs and release steps
* Project details export includes Writing and Music
* Code: projects-core.js (tracking, mergeData), share.js, sync.js, projects-sync.js, writing-*.js, music-*.js, file-store.js (keys); style.css sections 31–33

**9 October 2026 (DaVinci Resolve and collaboration)**

* Logo: a 2px dark outline around the shoe, like the callout borders
* Media & Transcripts
  * Transcripts from DaVinci Resolve: subtitle .srt files that start at the timeline's 01:00:00:00 are moved back to 00:00; [Speaker 1] labels become speakers; frame timecodes (01:00:05:12) and time ranges in .txt files are read. "Shift times" moves a transcript's times by any amount
  * Import Resolve markers (.edl from Timeline Markers to EDL, or a CSV from the Edit Index): listed with colour, name and note; add them all (or one colour) as comments on the page
  * Where everyone keeps the media: each person's footage and proxy folders and notes
* Export Timeline
  * Clip paths for: point the exported timeline at someone else's footage folder, so Resolve finds the clips
  * Coloured markers for Resolve (.edl): a marker per line of the edit, spanning its length; sections red, soundbites blue, narration green, B-roll yellow, titles purple
* Packaging
  * Deliverables for each platform with the DaVinci Resolve settings for each (render presets, loudness, captions, thumbnail, vertical version, project archive), custom items and "Copy as a checklist"; counted in the checklist
  * YouTube chapters from imported Resolve markers (all, or one colour)
  * One story, several outputs: + New package takes several platforms and an optional pitch; packages made together share their keywords and audience. Pitches cards have "Package it" (video, article and zine listing)
* Team
  * Tasks: give people jobs with due dates; Everyone (by person) or My tasks (this project or all projects). Comments assigned to someone are listed with their tasks
  * Credits: end credits from the team's roles and the people filmed, as text for a Resolve title, PNG cards (transparent, 1920 × 1080, 4K or vertical) or one tall scrolling roll
* Comments: assign a comment to a team member (when writing it, or on any comment)
* Calendar: tasks' due dates; "Shared calendar…" makes one .ics for everyone (fixed file name for a shared folder, calendar name, hourly refresh for subscriptions, step-by-step help)
* Projects
  * Share: a file for collaborators with everything in the project, uploaded files included
  * Import can merge a collaborator's copy into yours (matched automatically). Lists are combined item by item; the last version sent or received is remembered, so one-sided changes and deletions apply without asking, and only things you both changed differently are listed to choose
  * Project details export includes Tasks
* Guides updated
* Code: share.js, team-tasks.js; media-core.js (parseMarkers, MARKER_COLORS, shiftSegments), file-store.js (keys); style.css section 30

**9 October 2026 (packaging)**

* Packaging page: titles, thumbnails and SEO in one place. One package per place the work will appear: YouTube video, Shorts/Reels/TikTok, Instagram post, article or web page, newsletter, zine shop listing, podcast episode, or something else
  * Brainstorm titles (★ the one to use, Enter adds another, title formulas built from your keyword) and thumbnail concepts (overlay text, notes, an optional mock-up image)
  * Description or caption with the "before more" cut-off shown; YouTube chapters from a paper edit's sections; credits from the Team page's roles
  * Tags and hashtags as chips, keywords (with ideas from the Project Tracker's taxonomy), alt text per image, and for web pages and listings the SEO title, meta description, URL slug and social share text
  * Live character counts against each platform's limits, feed, search-result and inbox previews, and a checklist
  * Copy buttons per field, Copy everything, Download (.txt)
* Projects page: the Details (.docx/PDF) export now includes Packaging
* Guides updated (new section 7, Packaging)
* Code: packaging.js; style.css section 29

**9 October 2026 (exports and guides)**

* Interviews: "Questions as PDF" in a person's window prints the questions picked for them, titled with their name, a tick box (☐) per question, grouped by topic, everything double spaced for notes
* Projects page: "Details (.docx)" and "Details (PDF)" on each card export everything in the project as a readable document (tracker details and goals, team, research, interviews and questions, pitches, ideas, calendar events, paper edits, storyboards, zines, media, datasets, resources, comments). Drawings and uploaded files are listed by name only
* Settings: "Guides and downloads"
  * How to use the app (PDF) and How to edit the code (PDF), from resources/docs/user-guide.html and code-guide.html; rebuild them with ./make-docs.sh (needs Google Chrome)
  * Download the blank app (.zip): every file the app uses (found by following the pages' links), plus the README, change log, scripts and guides. Code only, no projects. Needs the app opened from a local server
* Code: zip.js (ZIP files), doc-export.js (documents as PDF or .docx), report.js (project details), settings.js; style.css additions in section 27
* Settings page tab title is now "Settings"

**9 October 2026 (calendar and script PDF)**

* A/V Script: "Save as PDF" lays the script out in Courier New 12pt (Time · Video · Audio, section headings across both columns) and opens the print window; choose "Save as PDF". The file is named after the edit
* Calendar page: every date entered across the project in one place
  * Project Tracker (began, target completion, target publication, finished, published), Interviews (shoots with time and place, release form dates), Pitches (date sent to each outlet), and your own events added here
  * List view grouped by month (past dates hidden unless you tick "Show past dates") and a month grid; filter by source; "All projects" shows every project that isn't archived
  * Download calendar (.ics) for Apple Calendar, Google Calendar or Outlook; Save list as PDF
  * Each entry links back to the page where its date was entered
* Code: calendar.js; style.css sections 27 (shared print layout: .print-sheet) and 28 (Calendar)

**9 October 2026 (pitches and more)**

* Text Edit: a "Remove sections…" menu next to Structure
  * Remove one starter structure's sections (e.g. "Three acts (3 sections)"), empty sections, or all sections; soundbites, narration and the rest stay put
  * Undo straight after removing
  * New structure sections are tagged; older ones are recognised by their names
* Research: each note can have several sources and references (one per line, links clickable). Older notes' single source carries over
* Interviews: two new stages after Filmed: Follow Up Requested and Follow Up Complete. People at or past Filmed aren't listed as "not scheduled"
* Data Analysis: "Make it with" ggplot2 or Datawrapper
  * Datawrapper: the R code prepares the chart's numbers and uses Datawrapper's API (via httr2: create, upload CSV, add source, publish) with your token from DATAWRAPPER_API_KEY. Bars → d3-bars, lines → d3-lines, scatter → d3-scatter-plot, histograms → column-chart (dates counted per month)
  * Both options' R code was run in R 4.5 against a test CSV; the API part was checked without sending anything
* Pitches page: working title, hook, story, why now, why me/access, format, length, audience, links, notes; status (Idea → Drafting → Ready to send → Pitched → Commissioned / Passed)
  * Outlets with editor, email, date sent and status; "Copy email" writes the pitch as an email to that editor, "Open in mail app" fills in a new email
  * Download a pitch as Markdown; filter by status and search
  * Ideas cards have "Pitch it →", which starts a pitch from the idea
* Fixed: chart legends and the Interviews schedule could show the word "false"; a pitch's length didn't load back into the form

**9 October 2026 (themes)**

* New themes on the Settings page (four buttons: Light, Dark, Rainbow, System Default)
  * Rainbow: every surface is one of the accent colours (a gradient behind the page, an accent for the sidebar and toolbars, cards cycling through all five accents). Text is black, or white on black fills, whichever has more contrast; black wins on all five accents
  * System Default: light or dark to match the computer's setting, switching live when it changes (with a backup check every couple of seconds and on focus)
* The "+" new-project button's plus is now drawn as a centred icon (the font's "+" sat off-centre)
* Theme buttons stack on screens narrower than 760px
* Code: new --color-on-text token for text on black/white fills (header rows, selected buttons, badges, tooltips); color-themes.js handles rainbow and system; style.css section 25
* Data Analysis R code is built on the page from fixed templates: it works offline and doesn't use an AI

**9 October 2026 (planning side)**

* Round buttons: the "+" (new project) turns a quarter and grows on hover, presses in when clicked; the comments button grows, its bubble wiggles and the count pops. Colour changes only if the computer asks for reduced motion
* Ideas (new page, in the sidebar): a three-column board for drafting notes and ideas. Rename the columns, add cards, drag (⠿) or ← → between columns; empty cards disappear
* Research: notes marked ? Unverified, ✓ Verified or ⚠ Disputed, with the exact quote or figure to check, a source (links clickable), notes and tags. Filter by status (with counts) and tag, search, change status from the card
* Interviews
  * People: a board by stage (Researching, Reached out, Pre-interview, Scheduled, Filmed); drag or ← →
  * Each person: who they are, contact, shoot date/time/location, release form (Not sent, Sent, Signed, Declined + date + notes), a logistics checklist (8 starter items, editable), and questions picked from the bank. Setting a shoot date moves them to Scheduled
  * Shoot schedule: upcoming, not yet scheduled and past shoots; download a calendar file (.ics)
  * Question bank: questions by topic, editable; "Add starter questions" adds 12 general documentary questions
* Data Analysis: load a CSV (kept in the browser's file storage)
  * Column profiles: type (number, date, date & time, true/false, text, guessed the way R's read_csv does), missing, unique, min/median/mean/max/std dev, a mini histogram or top values
  * Filters for numbers, text, dates and true/false; rows table (first 100)
  * Charts: histogram, bar (count/sum/average/median, top 15), scatter (coloured by up to 3 groups + Other), line over time (by day/week/month/year). Hover for values; "Show as a table" for the numbers
  * Writes matching R code (tidyverse + ggplot2) to copy or save as .R; it doesn't run R
  * Chart colours are from the validated palette, with separate steps for dark mode; group colours don't change when you filter

**9 October 2026 (styling)**

* Removed the offset shadows everywhere: page titles, callout boxes, the "+" and comments buttons, dialogs, the Projects panel, cards, toolbars, Text Edit panes, A/V script, image pins. Borders are unchanged
  * The "+" button no longer shifts on hover/press (that effect came from its shadow)
  * Selected comments are shown with an outline instead of a shadow; search results get a light tint on hover
  * Zine and storyboard pages have a hairline edge instead of a soft shadow, so white pages stay visible on white cards
* .claude/launch.json now changes into the project folder before starting the server

**9 October 2026 (editing side)**

* Media & Transcripts page (three tabs)
  * Media: import transcripts (.srt, .vtt, .txt from Descript/Otter/Rev etc.) or paste them; import clips from FCPXML (Final Cut, Resolve) or Premiere XML; transcripts link to clips by name so timecodes line up; rename speakers; search every transcript; project frame rate
  * Text Edit: transcript beside the paper edit. Select words → soundbite, click a timecode for a whole paragraph, or drag it across. Blocks: soundbite, narration, B-roll, title, section; drag or ↑↓ to reorder; trim by In/Out timecode; running time total and per speaker; used lines underlined; starter structures (three acts, investigation, character profile, explainer); several edits per project
  * Export Timeline: FCPXML 1.9, Premiere XML, CMX3600 EDL. Narration/B-roll/titles become gaps with markers; sections become markers. A round trip through files, not a live link
* A/V Script page: the edit as a two-column Video/Audio script with editable "what we see" notes and linked storyboard frames; save as .md or .txt
* Storyboarder: shot-size framing guide (figure outline per shot size), and links from frames to blocks in an edit (fills empty notes from the block)
* Code: media-core.js, media.js, text-edit.js, timeline-export.js, av-script.js; style.css sections 19–20
* Not done yet: planning side (Research, Interviews, Ideas page, Data desk)

**9 October 2026**

* Team page
  * Every project has its own team. "Team for" picks which project's team to see (it doesn't change your active project)
  * Add people with name, pronouns, roles, email, phone, preferred contact, other contact (website, social, Signal…), location or time zone, and notes
  * Roles: pick several from a starter list (Producer, Director, Reporter, Editor, Camera, Animator…) or type your own; your own roles are offered for the rest of that project's team
  * Contact cards show clickable email, phone and website links
  * Filter by role (with counts), search, sort by order added, name or role
  * Copy emails (ready for an email's To: line), download contact cards (.vcf) for one person or the whole team, Export CSV
  * Teams are saved inside each project, so backups and duplicates include them
  * Added team.js; style.css section 18
* Project Tracker: Team Members column now shows the people from each project's Team page
  * Name tags (hover for roles); "Edit team →" / "Add people →" opens the Team page on that project (team.html?project=…)
  * Names typed into the column before keep showing, with "Add to team" to turn them into Team page entries (splits on commas and "and", skips people already on the team)
  * Search finds projects by team members' names and roles; sorting and the CSV use the team's names (with roles)
  * On phones the pinned Project Name column is narrower

* Project Tracker: goals
  * Each goal card has a "Remove goal" button along its bottom (it asks first if the goal has anything in it)
  * Removing every goal leaves the project with no goals, instead of four new blank ones appearing next time
* Archiving projects
  * Archive a finished project from the Project Tracker or the Projects page; Unarchive to bring it back
  * Archived projects are hidden from the tracker, the Projects page and the sidebar's project menu. Tick "Show archived (n)" to see them (they look faded, with an "Archived" badge)
  * The project you're working in can't be archived (switch to another one first). Making an archived project active takes it out of the archive
  * Backups keep whether a project is archived
* Projects page: a project's tracker details count as 1 item (it said "tracker: 15", counting its fields)
* Code
  * projects-core.js: Projects.setArchived(id, true/false); list() and info() include `archived`

**8 October 2026 (later that night)**

* Project Tracker
  * One row for every project on the site; editing Project Name renames the project
  * Columns: Project Name, Medium, Status, In Progress, Next Up, Link to Pitch Doc, Team Members, Target Completion, Taxonomy, Began On, Target Publication, Finished On, Published On, Link to Final Product, Notes
  * Status: Not Started, Some Progress, About Halfway, Substantial Progress, Done (coloured by progress)
  * In Progress / Next Up: Not Started, Planning, Research, Interview, Recording, Writing, Video Editing, Review, Polishing, Done
  * Dates can be typed (12 Oct 2026, Oct 12, 2026-10-12, 12/10/26, today, tomorrow, March 2027) or picked from a calendar; impossible dates are flagged in red
  * Target dates turn red once they've passed and the project isn't finished/published
  * Medium suggests common formats but accepts anything
  * Links get a ↗ button to open them
  * Search, filter by status (with counts), sort by any column, Export CSV
  * "+ Add project" adds a project without leaving the one you're in; "Make active" switches to it
  * The table scrolls sideways with the Project Name column pinned
  * Goals (matching the goal template): a Goals column shows "1 of 4 done · 3/8 tasks"; click it to open the project's goal cards underneath
    * Each goal: Goal #n name, Sub-tasks with checkboxes, People Involved, Status (same five options, Not Started in red), Barriers as bullets
    * Starts with four goals side by side like the template; "+ Add goal" for more, × to delete one
    * In sub-task and barrier lists, Enter adds a new line and Backspace on an empty line removes it
    * Text wraps and the boxes grow to fit; every part lines up across the cards like a table
    * Goals are included in search, sorting (by share of goals done) and the CSV export
* Code
  * Added project-tracker.js; style.css section 17
  * projects-core.js: Projects.getDataFor / setDataFor (any project's data), and create() can skip switching ({ activate: false }) and returns the new id
  * main.is-wide lets a page use the full width beside the sidebar

**8 October 2026 (night)**

* Storyboarder
  * Storyboards live inside the active project, shown as cards (Open, Edit, Duplicate, Delete)
  * New storyboard: Video or Animation, frame shape (16:9, 2.39:1, 1.85:1, 4:3, 1:1, 4:5, 9:16), frame rate for animation (12/24/25/30 fps), starting number of shots
  * The board: every shot as a panel with its drawing and notes (scene, seconds, shot type, camera move, transition, action, dialogue, sound & music)
    * Running time shown for each shot and the whole board; animation also shows frame counts
    * Reorder by dragging ⠿ or with ← →; insert, duplicate, delete; "Show notes" hides notes for a quick overview
  * Draw a shot full size with the same tools as the Zine Planner, notes alongside
    * Safe-area and rule-of-thirds guides
    * Background photo behind the drawing (e.g. a location or reference still)
    * Previous/next shot buttons, or [ and ]
  * Play animatic: plays shots for their durations with captions, dissolve/fade/wipe transitions, progress bar to jump, Space to play/pause
  * Print: a clean sheet of frames with their notes
* Code
  * Moved the drawing engine out of zine-sketch.js into sketch-core.js, shared by the Zine Planner and Storyboarder
    * Undo now tracks pages themselves instead of zine page numbers
    * Fixed: Undo while a text box was still being typed in could lose the Redo step
  * zine-sketch.js now only handles zine spreads, the overview and page count
  * Added storyboarder.js; style.css sections 14 (Drawing pages, shared) and 16 (Storyboarder)
  * Drawing classes renamed from zine-page/zine-text to sketch-page/sketch-text
  * Drawing tool settings are saved under a new name, so tools reset to Pen once

**8 October 2026 (late)**

* Page padding: sides shrink to 2.5rem on tablets and 1rem on phones (was 5rem everywhere)
* Dark mode: buttons, fields, dropdowns and tables inside pastel callouts and dialogs now use dark ink on white, so they're readable. The boxes' own borders and shadows still follow the theme
* Dropdown arrows are defined once (--arrow-dark, --arrow-light) and each theme picks one
* Zine Planner: the spine is now a plain thin line where pages meet, instead of the shaded booklet look
* Comments
  * The drawer shows which project the comments belong to ("in My Project"); "All pages" is now "All pages in project"
  * Projects page counts comments one by one (it was counting the pages that had comments)
  * Added Projects.countItems() in projects-core.js, used by both project summaries

**8 October 2026 (evening)**

* Zine Planner
  * Zines live inside the active project, shown as cards with a cover preview (Sketch, Critique, Edit, Duplicate, Delete)
  * New zine dialog with presets: Mini zine (8 pages), Pocket zine (16), Half-size zine (12), Digest (24), Custom
  * Paper: US Letter or A4. Page sizes:
    * US Letter Half (5.5 × 8.5 in), Quarter (4.25 × 5.5 in), Eighth (2.75 × 4.25 in)
    * A5 (148 × 210 mm), A6 (105 × 148 mm), A7 (74 × 105 mm): the metric names for half, quarter and eighth of A4
  * Portrait or landscape; shows roughly how many sheets it prints on
  * Sketch tab
    * Pen (follows drawing-tablet pressure), Marker, Eraser and Text tools, 8 colours plus a custom colour, line width
    * Text boxes: click to add, drag ⠿ to move, drag the right edge to resize, choose font and size
    * Pages shown as booklet spreads (front cover on the right), or "All pages" to see every spread at once
    * Add or remove 4 pages at a time, margin guides, undo/redo (Ctrl/Cmd+Z), shortcuts P / M / E / T
    * Drawings are saved as lines, not pictures, so they stay sharp at any size and take little space
  * Critique tab
    * Upload files (button or drag and drop): images, PDFs, video, audio, text, anything else
    * Images: click a spot to pin a numbered comment. PDFs: comments can name a page. Video/audio: comments remember the moment
    * Uploaded files are kept in the browser's IndexedDB (too big for normal storage). They aren't included in project backups
* Comments (every page)
  * Speech-bubble button above the "+" opens a Comments drawer for the page you're on, with a count of open comments
  * Select text on the page first to quote it; click a quote to jump back to that text
  * Reply, edit, resolve/reopen, delete; "Show resolved"; "All pages" lists every page's comments in this project
  * Your name is remembered in this browser
  * Comments are saved inside the active project
* Code
  * Added comments.js (loaded on every page), file-store.js, zine-planner.js, zine-sketch.js, zine-critique.js
  * Projects.collect(key) in projects-core.js (used to check whether an uploaded file is still used by any project)
  * style.css sections 13 (Comments) and 14 (Zine Planner)
  * .claude/launch.json runs the local server (python3 -m http.server 8123)

**8 October 2026**

* Made it so that selected text is blue
* Navigation
  * Sidebar no longer covers page content: content sits beside it with 4rem of padding
  * Added a hamburger button (all screen sizes) that opens and closes the sidebar
    * Desktop: sidebar pushes the page over, and remembers if you closed it
    * Tablet/phone: sidebar slides over the page with a dimmed backdrop
  * Added a "Return to top" button at the bottom of every page
  * Added a Projects link to the sidebar
* Page styling
  * Page titles are now in a callout that fits the text
  * Pages can hold stacked content (paragraphs, callouts, card grids) with even spacing
  * Added reusable callout boxes in each accent colour
  * Theme picker now sits in a callout
  * Theme buttons: consolidated their CSS into one block with editable variables, and fixed the white ring that stayed after clicking
  * Dropdown arrows sit further from the edge (adjust with --select-arrow-inset in style.css)
* Themes
  * Fixed: dark mode only worked on the Settings page (the theme script crashed on pages without the buttons). It now applies on every page, with no flash of the light theme
  * Fixed the Faculty Glyphic font import
* Resources page
  * Default Resources table, loaded from resources/data/default-resources-cobbler-project.csv
    * Can be hidden/shown
    * Swap the CSV to change the table
    * Links can show text instead of the full address, written as [Here](https://...)
  * Your Resources table
    * Add resources one at a time with a form (name, description, link, optional link text)
    * Upload a CSV (comma, semicolon or tab separated)
    * Remove rows, clear the table (asks first), export as CSV
  * Opening pages by double-clicking (file://): the default table reads a generated copy of the CSV (default-resources-cobbler-project.js)
    * Added update-resources.sh to regenerate that copy after editing the CSV
    * When running a local server (python3 -m http.server 8123), the page reads the CSV directly
* Projects
  * A project holds everything you make on the site: each page saves its own data inside the active project
  * Existing Resources data moved into a project called "My Project"
  * Projects button in the sidebar (shows the current project) opens a panel beside the sidebar
    * Switch, rename and delete projects
    * New project
    * Back up this project or all projects, and restore from a backup
  * Round "+" button (bottom right of every page) to create a project from anywhere
  * Added Projects page
    * Cards for each project with search and sort
    * Make active, rename, duplicate, export, delete
    * Import backup files (pick or drag in), preview them, choose which to add. Imports never overwrite existing projects
* Code
  * Split the scripts into separate files
    * projects-core.js (project storage)
    * header.js (sidebar)
    * project-ui.js (project controls)
    * color-themes.js
    * resources.js
    * projects.js
  * Every page now loads projects-core.js, header.js, project-ui.js and color-themes.js
  * Reorganised style.css into 12 numbered sections and removed duplicate rules
  * Added comments throughout the JS and CSS explaining what each part does
  * Saved the pre-rewrite files in _backup-2026-10-08

**7 October 2026**

* Added pages
  * About
  * A/V Script
  * Calendar
  * Data Analysis
  * Index
  * Interviews
  * Media and Transcripts
  * Packaging
  * Pitches
  * Project Tracker
  * Research
  * Resources
  * Settings
  * Storyboarder
  * Team
  * Zine Planner
* Added switchable themes (didn't finish though)
* Added navigation bar skeleton
* Set font to Faculty Glyphic for h1-h4, body text