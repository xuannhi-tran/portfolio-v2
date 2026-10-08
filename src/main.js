// Hash routes: #/ (cover, about, contact), #/projects (record shelf), #/projects/<slug> (that record
// playing), #/list (static cards).
// Plain #about / #contact links keep working and scroll within the home view.
// Without JS every section is visible, so the content stays readable.

import { initAbout } from "./about.js";
import { initShelf, enterShelf, leaveShelf, syncShelfRoute } from "./shelf.js";

const views = document.querySelectorAll("[data-view]");
const projectsLink = document.querySelector('[data-nav="projects"]');

// Dev-only preview of the 3D turntable and record: #/dev/turntable (not in production builds)
let unmountDev = null;
let devToken = 0;

function route() {
  const hash = location.hash;
  let view = "home";
  let target = null;

  const token = ++devToken;
  if (import.meta.env.DEV) {
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
  if (hash === "#/projects") {
    view = "shelf";
  } else if (project) {
    view = "shelf";
    slug = project[1]; // an unknown slug is sent back to #/projects by the shelf
  } else if (hash === "#/list") {
    view = "list";
  } else if (hash === "#projects") {
    // Old anchor: send it to the shelf.
    location.replace("#/projects");
    return;
  } else if (!hash.startsWith("#/") && hash.length > 1) {
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el?.dataset.view === "home") target = el;
  }

  views.forEach((el) => {
    el.hidden = el.dataset.view !== view;
  });

  if (projectsLink) {
    if (view === "home") projectsLink.removeAttribute("aria-current");
    else projectsLink.setAttribute("aria-current", "page");
  }

  if (target) target.scrollIntoView();
  else window.scrollTo(0, 0);

  // The 3D scene only exists while the shelf is on screen.
  if (view === "shelf") {
    enterShelf();
    syncShelfRoute(slug);
  } else {
    leaveShelf();
  }
}

initShelf();
initAbout();
window.addEventListener("hashchange", route);
route();
