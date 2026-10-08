// Record shelf screen: the text list, the 3D scene, and the controls around it.
// three.js and gsap are imported only when the screen opens, so the cover stays light.
//
// States (mirrored from the scene): "stack" -> "transitioning" -> "playing".
//  - stack: the text list is shown. Hovering or focusing a title, or hovering a sleeve, lifts
//    that sleeve; clicking either one picks the record.
//  - transitioning: input is ignored, except Esc or a click anywhere, which jumps to the end.
//  - playing: the heading and the list are hidden. The other records are the way to swap:
//    on wide screens the 3D sleeves on the left (plus visually hidden buttons for keyboard
//    and screen readers), on narrow screens a row of thumbnail buttons. "← All records"
//    (or Esc) puts the record back and returns to the stack.
//  - The info panel of the playing record fades in on the right (below the turntable on narrow
//    screens); its fade is part of the scene's timeline, so it fades out first on eject / swap.
//
// Routes: #/projects (the stack) and #/projects/<slug> (that record playing). Picking, swapping and
// ejecting update the hash; opening a URL, back and forward jump straight to the state, no animation.

import { COMPACT, PANEL } from "./scene/tweaks.js";

const shelf = document.querySelector(".shelf");
const crate = document.querySelector(".crate");
const tracks = [...document.querySelectorAll(".track")];
const canvas = document.getElementById("scene");
const status = document.getElementById("shelf-status");
const ejectButton = document.getElementById("eject");
const compactQuery = matchMedia(COMPACT.query);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const info = document.getElementById("info");
const panels = [...document.querySelectorAll(".panel")].sort((a, b) => a.dataset.index - b.dataset.index);
const slugs = tracks.map((t) => t.dataset.slug);
const hashFor = (i) => (i >= 0 ? `#/projects/${slugs[i]}` : "#/projects");
let wantedSlug = null; // from the URL
let routing = false; // true while the URL (not the user) is changing the state

// Was the last input a key press (true) or a pointer press (false)?
let usingKeyboard = false;
document.addEventListener("keydown", () => (usingKeyboard = true), true);
document.addEventListener("pointerdown", () => (usingKeyboard = false), true);

let active = -1; // hovered / focused item
let picked = -1; // the record that is playing (or on its way)
let uiState = "stack";
let lastAction = "pick"; // "pick" | "swap" | "eject": decides where focus goes afterwards
let scene = null;
let entered = false;
let transitionStart = 0;

const titles = tracks.map((t) => t.querySelector(".track-title").textContent);
let playButtons = []; // visually hidden, wide screens
let thumbs = []; // visible, narrow screens

// ---- Controls to play another record while one is on the turntable ---------
function buildPlayControls() {
  // Wide screens: one visually hidden button per record, so the 3D sleeves are keyboard
  // and screen reader accessible. Hovering / focusing one lights up its sleeve.
  const group = document.createElement("div");
  group.className = "play-buttons";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Play another record");
  titles.forEach((title, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `Play ${title}`;
    b.hidden = true;
    wireItem(b, i);
    // Keyboard focus on any of them spreads the collapsed group out; focus leaving it collapses it.
    // (Focus that a script moved after a mouse click does not count, so a swap made with the
    // mouse leaves the group collapsed afterwards.)
    b.addEventListener("focus", () => {
      if (usingKeyboard) scene?.expand();
    });
    b.addEventListener("blur", (e) => {
      if (!group.contains(e.relatedTarget)) scene?.requestCollapse();
    });
    group.append(b);
    playButtons.push(b);
  });
  shelf.append(group);

  // Narrow screens: a row of tappable cover thumbnails under the turntable
  const row = document.createElement("div");
  row.className = "thumbs";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Play another record");
  [...document.querySelectorAll(".cover-template")]
    .sort((a, b) => a.dataset.index - b.dataset.index)
    .forEach((template, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "thumb";
      b.setAttribute("aria-label", `Play ${titles[i]}`);
      b.hidden = true;
      b.append(template.content.firstElementChild.cloneNode(true));
      wireItem(b, i);
      row.append(b);
      thumbs.push(b);
    });
  crate.append(row);
}

function wireItem(el, i) {
  el.addEventListener("pointerenter", () => setActive(i));
  el.addEventListener("focus", () => setActive(i));
  el.addEventListener("pointerleave", () => active === i && setActive(-1));
  el.addEventListener("blur", () => active === i && setActive(-1));
  el.addEventListener("click", () => requestPick(i));
}

// ---- The info panel ---------------------------------------------------------
// Wide screens: in the right column, level with the scene. Narrow screens: in the page flow,
// pulled up under the row of thumbnails.
function placePanel() {
  if (!info) return;
  if (compactQuery.matches) {
    const w = crate.getBoundingClientRect().width;
    const h = crate.getBoundingClientRect().height;
    const thumbSize = (w - 24) / 3;
    const free = h - (h * 0.58 + thumbSize); // empty space left under the thumbnails in the crate
    info.style.cssText = `margin-top: ${-Math.max(0, free - 24)}px`;
    return;
  }
  const shelfRect = shelf.getBoundingClientRect();
  const crateRect = crate.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  const width = Math.min(PANEL.maxWidth, viewport * PANEL.widthFraction);
  info.style.cssText = [
    `left: ${viewport - width - PANEL.margin - shelfRect.left}px`,
    `top: ${crateRect.top - shelfRect.top}px`,
    `width: ${width}px`,
    `height: ${crateRect.height}px`,
  ].join(";");
}

// Called by the scene while a record's panel fades in or out (amount 0..1)
function onPanel(index, amount) {
  const reduce = reducedMotion();
  panels.forEach((panel, i) => {
    const visible = i === index && amount > 0.001;
    if (!visible) {
      panel.hidden = true;
      return;
    }
    const wasHidden = panel.hidden;
    panel.hidden = false;
    if (wasHidden) placePanel();
    panel.style.setProperty("--slide", reduce ? "0px" : `${(1 - amount) * PANEL.slide}px`);
    if (reduce && wasHidden) {
      // Reduced motion: no slide, just a quick opacity change (see the CSS transition)
      panel.style.opacity = "0";
      requestAnimationFrame(() => (panel.style.opacity = String(amount)));
    } else {
      panel.style.opacity = String(amount);
    }
  });
}

// ---- State ------------------------------------------------------------------
function render() {
  shelf.dataset.state = uiState;
  const playing = uiState === "playing";
  const compact = compactQuery.matches;

  tracks.forEach((track, i) => {
    track.classList.toggle("is-active", uiState === "stack" ? i === active : i === picked);
    track.setAttribute("aria-pressed", String(i === picked));
    if (uiState === "stack") track.removeAttribute("aria-disabled");
    else track.setAttribute("aria-disabled", "true");
  });

  // The record that is playing can't be played again; the others can, once it is playing
  playButtons.forEach((b, i) => (b.hidden = !(playing && !compact && i !== picked)));
  thumbs.forEach((b, i) => (b.hidden = !(playing && compact && i !== picked)));

  if (status) status.textContent = playing && picked !== -1 ? `Now playing: ${titles[picked]}` : "";
  if (ejectButton) ejectButton.hidden = uiState === "stack";
}

function setActive(i) {
  if (uiState === "transitioning") return;
  active = i;
  render();
  scene?.setActive(i);
}

function requestPick(i) {
  if (!scene) return;
  if (uiState === "stack") {
    lastAction = "pick";
    scene.pick(i);
  } else if (uiState === "playing" && i !== picked) {
    lastAction = "swap";
    scene.swap(i);
  }
}

function requestEject() {
  if (!scene || uiState !== "playing") return;
  lastAction = "eject";
  scene.eject();
}

// After a swap, focus goes to the next record in the row that can be played
function focusNextPlayable(from) {
  const list = (compactQuery.matches ? thumbs : playButtons).filter((b, i) => i !== picked && !b.hidden);
  const next = list.find((b) => (compactQuery.matches ? thumbs : playButtons).indexOf(b) > from) ?? list[0];
  (next ?? ejectButton)?.focus({ preventScroll: true });
}

function onStateChange(next, index) {
  const previous = uiState;
  uiState = next;

  if (next === "transitioning") {
    transitionStart = performance.now();
    active = -1;
    if (!routing) {
      // The URL follows what the user does (picking, swapping and ejecting add history entries)
      const target = hashFor(lastAction === "eject" ? -1 : index);
      if (location.hash !== target) history.pushState(null, "", target);
    }
    if (previous === "stack") {
      picked = index;
      // Bring the scene into view: the stack's column, or the top of it on narrow screens
      crate.scrollIntoView({
        block: compactQuery.matches ? "start" : "center",
        behavior: routing || reducedMotion() ? "auto" : "smooth",
      });
    }
  }

  const wasPicked = picked;
  if (next === "playing") picked = index;
  if (next === "stack") picked = -1;
  render(); // first, so the controls are visible and can take focus

  if (next === "playing") {
    placePanel();
    if (lastAction === "swap" && !routing) focusNextPlayable(index);
    else panels[index]?.querySelector(".panel-title")?.focus({ preventScroll: true }); // the panel just opened
  }
  if (next === "stack" && previous !== "stack" && !routing) {
    // The heading and the list are back: scroll up to them
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  if (next === "stack" && !routing && (document.activeElement.closest?.(".panel") || document.activeElement === ejectButton || document.activeElement === document.body)) {
    // Back where we started: return keyboard focus to the record that was picked
    tracks[wasPicked]?.focus({ preventScroll: true });
  }
}

export function initShelf() {
  buildPlayControls();

  tracks.forEach((track, i) => wireItem(track, i));
  ejectButton?.addEventListener("click", requestEject);
  panels.forEach((panel) => panel.querySelector(".panel-back")?.addEventListener("click", requestEject));
  compactQuery.addEventListener("change", () => {
    render();
    placePanel();
  });
  window.addEventListener("resize", placePanel);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !scene) return;
    if (uiState === "playing") requestEject();
    else if (uiState === "transitioning") scene.skip();
  });

  // A click anywhere while it is moving jumps to the end (ignoring the click that started it)
  document.addEventListener("click", () => {
    if (uiState === "transitioning" && performance.now() - transitionStart > 150) scene?.skip();
  });

  render();
}

// No WebGL: the list view is the experience.
function fallBackToList() {
  location.replace("#/list");
}

export async function enterShelf() {
  entered = true;
  if (scene || !canvas) return;

  try {
    const { createShelfScene } = await import("./scene/index.js");
    const covers = [...document.querySelectorAll(".cover-template")]
      .sort((a, b) => a.dataset.index - b.dataset.index)
      .map((template) => ({ template, ...template.dataset }));

    const created = await createShelfScene({
      canvas,
      covers,
      onHover: setActive,
      onSelect: requestPick,
      onStateChange,
      onPanel,
    });

    if (!entered) {
      created.dispose(); // left the screen while it was loading
      return;
    }
    scene = created;
    render();
    applyRoute();
  } catch (err) {
    console.warn("3D shelf unavailable, showing the list instead.", err);
    fallBackToList();
  }
}

export function leaveShelf() {
  entered = false;
  wantedSlug = null;
  scene?.dispose();
  scene = null;
  active = -1;
  picked = -1;
  uiState = "stack";
  render();
}

// ---- Routes -------------------------------------------------------------------
// Make the shelf match the URL: slug = "rag" etc. opens that record, null = the stack.
// Called when the route changes (a fresh tab, back / forward, the nav link).
export function syncShelfRoute(slug) {
  wantedSlug = slug;
  applyRoute();
}

function applyRoute() {
  if (!scene) return; // applied as soon as the scene exists
  let index = wantedSlug ? slugs.indexOf(wantedSlug) : -1;
  if (wantedSlug && index === -1) {
    history.replaceState(null, "", "#/projects"); // unknown slug: back to the stack
    index = -1;
  }
  routing = true;
  scene.jumpTo(index);
  routing = false;
}