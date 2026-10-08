// Hash routes: #/ (cover, about, contact), #/projects (record shelf), #/list (static cards).
// Plain #about / #contact links keep working and scroll within the home view.
// Without JS every section is visible, so the content stays readable.

import { initShelf, enterShelf, leaveShelf } from "./shelf.js";

const views = document.querySelectorAll("[data-view]");
const projectsLink = document.querySelector('[data-nav="projects"]');

function route() {
  const hash = location.hash;
  let view = "home";
  let target = null;

  if (hash === "#/projects") {
    view = "shelf";
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
  if (view === "shelf") enterShelf();
  else leaveShelf();
}

initShelf();
window.addEventListener("hashchange", route);
route();
