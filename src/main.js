// One scrolling page: hero, Projects (the record row), About, Contact. Hash routes:
//   #/                     the top of the page
//   #/projects             scrolls to the Projects section
//   #/projects/<slug>      scrolls there and opens that record
//   #about / #contact      scroll to those sections
//   #/list                 the static cards (the fallback view, replaces the page)
// Without JS every section is visible, so the content stays readable.

import { initAbout } from "./about.js";
import { initHero } from "./hero.js";
import { initShelf, enterShelf, leaveShelf, syncShelfRoute } from "./shelf.js";

const views = document.querySelectorAll("[data-view]");
const projectsLink = document.querySelector('[data-nav="projects"]');

// Dev-only preview of the 3D turntable and record: /?dev=1#/dev/turntable (dev server only, never in production builds)
let unmountDev = null;
let devToken = 0;
let firstRoute = true; // the first scroll (a fresh load) is instant, later ones are smooth

function route() {
  const hash = location.hash;
  let view = "home";
  let target = null;

  const token = ++devToken;
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("dev")) {
    unmountDev?.();
    unmountDev = null;
    if (hash === "#/dev/turntable") {
      views.forEach((el) => {
        el.hidden = true;
      });
      leaveShelf();
      import("./scene/dev.js").then((dev) => {
        if (token === devToken) unmountDev = dev.mountDevPreview();
      });
      return;
    }
  }

  let slug = null;
  const project = hash.match(/^#\/projects\/([\w-]+)$/);
  if (hash === "#/projects" || project) {
    target = document.getElementById("shelf");
    slug = project ? project[1] : null; // an unknown slug is sent back to #/projects by the shelf
  } else if (hash === "#/list") {
    view = "list";
  } else if (hash === "#projects") {
    // Old anchor: send it to the Projects section.
    location.replace("#/projects");
    return;
  } else if (!hash.startsWith("#/") && hash.length > 1) {
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el?.dataset.view === "home") target = el;
  }

  views.forEach((el) => {
    el.hidden = el.dataset.view !== view;
  });

  const behavior = firstRoute || matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  firstRoute = false;

  if (view === "list") {
    window.scrollTo(0, 0);
    leaveShelf();
    return;
  }

  if (target) target.scrollIntoView({ behavior });
  else window.scrollTo({ top: 0, behavior });

  // A record is only open for a #/projects/<slug> route; any other route closes it
  if (slug) enterShelf();
  syncShelfRoute(slug);
}

initShelf();
initAbout();
initHero();
window.addEventListener("hashchange", route);
route();
