// One scrolling page: hero, Projects (the record row), About, Contact. Hash routes:
//   #/                     the top of the page (the hero)
//   #/projects             scrolls to the Projects section
//   #/projects/<slug>      scrolls there and opens that record
//   #/about, #/contact     scroll to those sections (#about / #contact still work)
//   #/list                 scrolls to the Projects section and shows it as a list (also the no-WebGL fallback)
// Without JS every section is visible, so the content stays readable.
//
// Clicking a link to a section scrolls smoothly (and adds a history entry, even when the hash is already the
// current one), closing an open record first. Opening a URL, back and forward jump straight to the state; the
// first scroll of a page load is always instant.

import { initAbout } from "./about.js";
import { initBackground } from "./background.js";
import { initHero } from "./hero.js";
import { initShelf, enterShelf, leaveShelf, syncShelfRoute, closeRecord, isRecordOpen, setMode, isListMode } from "./shelf.js";

const sections = document.querySelectorAll("main > section");
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Where each route goes: the section (its id), and the heading that takes focus
const SECTIONS = {
  cover: { id: "cover", heading: "name" },
  projects: { id: "shelf", heading: "shelf-title" },
  about: { id: "about", heading: "about-title" },
  contact: { id: "contact", heading: "contact-title" },
};

// Dev-only preview of the 3D turntable and record: /?dev=1#/dev/turntable (dev server only, never in production builds)
let unmountDev = null;
let devToken = 0;
let firstRoute = true; // the first scroll (a fresh load) is instant, later ones are smooth
let movedByUser = false; // the visitor has scrolled (wheel, touch or keys) since the page loaded
for (const type of ["wheel", "touchmove", "keydown"]) addEventListener(type, () => (movedByUser = true), { once: true, passive: true });

function parse(hash) {
  if (!hash || hash === "#" || hash === "#/" || hash === "#cover") return { name: "cover" };
  if (hash === "#/list") return { name: "projects", slug: null, list: true }; // the Projects section in list mode
  const project = hash.match(/^#\/projects(?:\/([\w-]+))?$/);
  if (project) return { name: "projects", slug: project[1] ?? null }; // an unknown slug is sent back to #/projects by the shelf
  if (hash === "#/about" || hash === "#about") return { name: "about" };
  if (hash === "#/contact" || hash === "#contact") return { name: "contact" };
  if (hash === "#projects") return { redirect: "#/projects" }; // old anchor
  return { name: "cover" };
}

// `user`: a click on a link (rather than the address bar, back or forward)
function route({ user = false } = {}) {
  const hash = location.hash;

  const token = ++devToken;
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("dev")) {
    unmountDev?.();
    unmountDev = null;
    if (hash === "#/dev/turntable") {
      sections.forEach((el) => {
        el.hidden = true;
      });
      leaveShelf();
      import("./scene/dev.js").then((dev) => {
        if (token === devToken) unmountDev = dev.mountDevPreview();
      });
      return;
    }
  }

  const target = parse(hash);
  if (target.redirect) {
    location.replace(target.redirect);
    return;
  }
  sections.forEach((el) => {
    el.hidden = false; // (the dev preview hides them)
  });

  const wasFirst = firstRoute;
  const behavior = firstRoute || reduced() ? "auto" : "smooth";
  firstRoute = false;

  // A click on the Projects link keeps the mode the section is in; a URL, back and forward say which mode they want
  const listWanted = isListMode();
  const go = () => {
    const section = SECTIONS[target.name];
    const el = document.getElementById(section.id);
    // scroll-margin-top (style.css) keeps the heading clear of the fixed nav
    if (target.name === "cover") window.scrollTo({ top: 0, behavior });
    else el.scrollIntoView({ behavior });
    // A fresh page load scrolls before the fonts and images have settled the layout: scroll again once they have,
    // unless the visitor has already moved the page themselves
    if (wasFirst && !target.slug) {
      const again = () => {
        if (!movedByUser) el.scrollIntoView({ behavior: "auto" });
      };
      document.fonts?.ready.then(again);
      if (document.readyState !== "complete") window.addEventListener("load", again, { once: true });
    }
    // Focus the heading (without scrolling again) so keyboard and screen reader users arrive there
    if (!target.slug) document.getElementById(section.heading)?.focus({ preventScroll: true });
    // A record is only open for a #/projects/<slug> route; any other route closes it
    if (target.slug) enterShelf();
    if (target.name === "projects") setMode(target.list || (!target.slug && user && listWanted) ? "list" : "records");
    syncShelfRoute(target.slug ?? null);
  };

  // A link clicked while a record is open: close it first (its reverse timeline), then scroll
  if (user && !target.slug && isRecordOpen()) closeRecord().then(go);
  else go();
}

// Links to the sections: the nav, the brand and the hero button. They scroll even when their hash is already the
// current one (the hash would not change, so the browser does nothing), and add one history entry otherwise.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target.closest?.("a[href^='#']");
  if (!link) return;
  let hash = link.getAttribute("href");
  const target = parse(hash);
  if (!target.name) return;
  if (hash === "#/projects" && isListMode()) hash = "#/list"; // the nav link keeps the list
  e.preventDefault();
  if (location.hash !== hash) history.pushState(null, "", hash);
  route({ user: true });
});

// ---- The nav link of the section in view ------------------------------------------------------------
// A thin band across the middle of the screen decides which section is "in view"; the hero has no link.
const navLinks = [...document.querySelectorAll("[data-nav]")];
const sectionOrder = ["cover", "shelf", "about", "contact"];
const inBand = new Set();
function markNav() {
  // At the very end of the page the last section (Contact, too short to reach the middle of the screen) counts
  const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  const id = atEnd && inBand.size ? sectionOrder.filter((s) => document.getElementById(s).offsetHeight > 0).pop() : sectionOrder.filter((s) => inBand.has(s)).pop();
  const name = Object.keys(SECTIONS).find((k) => SECTIONS[k].id === id);
  navLinks.forEach((a) => {
    if (a.dataset.nav === name && name !== "cover") a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  });
}
const bandObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => (e.isIntersecting ? inBand.add(e.target.id) : inBand.delete(e.target.id)));
    markNav();
  },
  { rootMargin: "-50% 0px -49% 0px" },
);
sectionOrder.forEach((id) => bandObserver.observe(document.getElementById(id)));
let navTick = 0;
window.addEventListener("scroll", () => {
  cancelAnimationFrame(navTick);
  navTick = requestAnimationFrame(markNav);
}, { passive: true });

initBackground();
// The section heads are as wide as the screen: --vw is the width of <main> (the page without the scrollbar; 100vw would include it)
const main = document.querySelector("main");
const setVw = () => document.documentElement.style.setProperty("--vw", `${main.getBoundingClientRect().width}px`);
new ResizeObserver(setVw).observe(main);
setVw();
initShelf();
initAbout();
initHero();
window.addEventListener("hashchange", () => route());
route();
