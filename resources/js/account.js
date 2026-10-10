/* =========================================================
   account.js — signing in and out (your name), on every page
   ---------------------------------------------------------
   A round button above the comments and "+" buttons shows who's
   signed in (their initial) or a person icon. Click it to sign
   in, change your name, or sign out.

   "Signing in" only tells the app your name, which goes on your
   changes, comments and synced files so collaborators know who
   did what. There's no password, and nothing leaves this browser.
   The name is kept in localStorage: cobblerMe (and commentAuthor,
   the name on comments).

   On a first visit it opens by itself, once; after that the
   button is always there.

   Needs projects-core.js.
   ========================================================= */
(() => {

  if (!window.Projects?.me) return;

  const ASKED_KEY = "askedName";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.flat().filter(c => c != null && c !== false && c !== ""));
    return node;
  }

  const PERSON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  /* Sets (or clears) your name everywhere it's used */
  function setName(name) {
    const clean = String(name || "").trim();
    Projects.setMe(clean);
    set("commentAuthor", clean || null);
    if (!clean) set("cobblerMe", null);
    document.querySelectorAll(".comment-author-input").forEach(i => { i.value = clean; });
    renderButton();
    document.dispatchEvent(new Event("projects-changed"));   // e.g. the Home dashboard
    document.dispatchEvent(new Event("account-changed"));
  }

  /* ---------- The round button ---------- */
  function renderButton() {
    let button = document.getElementById("account-fab");
    if (!button) {
      button = el("button", { type: "button", class: "fab account-fab", id: "account-fab", "aria-haspopup": "dialog" });
      button.addEventListener("click", openDialog);
      document.body.append(button);
    }
    const name = Projects.me();
    if (name) {
      button.textContent = name.trim()[0].toUpperCase();
      button.classList.add("is-signed-in");
      button.title = `Signed in as ${name}`;
      button.setAttribute("aria-label", `Signed in as ${name}: change or sign out`);
    } else {
      button.innerHTML = PERSON;
      button.classList.remove("is-signed-in");
      button.title = "Sign in (your name)";
      button.setAttribute("aria-label", "Sign in with your name");
    }
  }

  /* ---------- Sign in / change / sign out ---------- */
  function openDialog() {
    document.getElementById("account-dialog")?.remove();
    const name = Projects.me();
    const input = el("input", { name: "name", maxlength: "60", autocomplete: "name", placeholder: "e.g. Aisha", required: true });
    input.value = name;
    const dialog = el("dialog", { class: "project-dialog account-dialog", id: "account-dialog", "aria-labelledby": "account-title" });
    const form = el("form", {},
      el("h2", { id: "account-title" }, name ? `Signed in as ${name}` : "Sign in"),
      el("p", {}, "Your name goes on your changes and comments, so the people you work with know who did what. There's no password: it's kept in this browser only."),
      el("label", {}, name ? "Change your name" : "Your name", input),
      el("div", { class: "dialog-actions" },
        el("button", { type: "submit", class: "small-btn" }, name ? "Save" : "Sign in"),
        name && el("button", { type: "button", class: "small-btn", onclick: () => {
          if (!confirm(`Sign out as ${name}? Your work stays here; new changes will just be marked “Someone” until you sign in again.`)) return;
          setName("");
          dialog.close();
          toast("Signed out.");
        } }, "Sign out"),
        el("button", { type: "button", class: "small-btn", onclick: () => dialog.close() }, name ? "Close" : "Not now")),
      el("p", { class: "account-help" },
        el("a", { href: "../resources/docs/user-guide.pdf", target: "_blank", rel: "noopener" }, "How to use the app (PDF)")));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      const was = Projects.me();
      setName(input.value);
      dialog.close();
      toast(was ? `Now signed in as ${input.value.trim()}.` : `Signed in as ${input.value.trim()}.`);
    });
    dialog.append(form);
    dialog.addEventListener("close", () => { dialog.remove(); document.getElementById("account-fab")?.focus(); });
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
    input.select();
  }

  function toast(message) {
    if (window.CobblerSync?.toast) CobblerSync.toast(message, [], { id: "account-toast" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderButton();
    // First visit: ask once (the button stays for later)
    if (!Projects.me() && !get(ASKED_KEY) && !/tests\.html$/.test(location.pathname)) {
      set(ASKED_KEY, "1");
      setTimeout(() => { if (!document.querySelector("dialog[open]")) openDialog(); }, 1200);
    }
  });
  // Name typed into the Comments panel's "Your name" box
  document.addEventListener("input", (event) => { if (event.target.matches?.(".comment-author-input")) renderButton(); });
    // Name changed in another tab (or by the Sync folder / Comments name boxes)
  window.addEventListener("storage", (event) => { if (event.key === "cobblerMe" || event.key === "commentAuthor") renderButton(); });

  window.CobblerAccount = { open: openDialog, setName };
})();
