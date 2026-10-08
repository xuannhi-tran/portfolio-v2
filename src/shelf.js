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

import { COMPACT } from "./scene/tweaks.js";

const shelf = document.querySelector(".shelf");
const crate = document.querySelector(".crate");
const tracks = [...document.querySelectorAll(".track")];
const canvas = document.getElementById("scene");
const status = document.getElementById("shelf-status");
const ejectButton = document.getElementById("eject");
const compactQuery = matchMedia(COMPACT.query);

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
    if (previous === "stack") {
      picked = index;
      // Bring the scene into view: the stack's column, or the top of it on narrow screens
      crate.scrollIntoView({
        block: compactQuery.matches ? "start" : "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }

  const wasPicked = picked;
  if (next === "playing") picked = index;
  if (next === "stack") picked = -1;
  render(); // first, so the controls are visible and can take focus

  if (next === "playing") {
    if (lastAction === "swap") focusNextPlayable(index);
    else ejectButton?.focus({ preventScroll: true });
  }
  if (next === "stack" && previous !== "stack") {
    // The heading and the list are back: scroll up to them
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  if (next === "stack" && (document.activeElement === ejectButton || document.activeElement === document.body)) {
    // Back where we started: return keyboard focus to the record that was picked
    tracks[wasPicked]?.focus({ preventScroll: true });
  }
}

export function initShelf() {
  buildPlayControls();

  tracks.forEach((track, i) => wireItem(track, i));
  ejectButton?.addEventListener("click", requestEject);
  compactQuery.addEventListener("change", render);

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
    });

    if (!entered) {
      created.dispose(); // left the screen while it was loading
      return;
    }
    scene = created;
    render();
  } catch (err) {
    console.warn("3D shelf unavailable, showing the list instead.", err);
    fallBackToList();
  }
}

export function leaveShelf() {
  entered = false;
  scene?.dispose();
  scene = null;
  active = -1;
  picked = -1;
  uiState = "stack";
  render();
}
