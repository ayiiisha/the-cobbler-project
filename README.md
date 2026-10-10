**INTRO**

_7 October 2026_

The purpose of this app is to establish an all-in-one project management, pre-production, production, and post-production system for journalists, filmmakers, artists, writers, and musicians alike. This undertaking will take several years, but could be worth it :P 


Cheers 

– Aisha

**RUNNING IT**

Open `pages/index.html`, or run `python3 -m http.server 8123` here and go to http://localhost:8123/pages/index.html. To put it online with GitHub Pages, see "Putting it online with GitHub Pages" in `resources/docs/code-guide.html`.

Once opened online, the app also works offline, and Chrome or Edge can install it like an app. Code checks (`npm run lint`, `npm test`: the self-tests page and every page in a headless browser) run on every push; see "Self-tests" in the code guide to run them yourself.

To change the Resources page's default table: on GitHub, Add file › Upload files, drop in a new `default-resources-cobbler-project.csv` (columns Name, Description, Link), Commit changes. The site shows it within a few minutes. Only the code goes online: projects stay in each person's browser (and their sync folder, if they choose one).
