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

import { CALLOUTS, COMPACT, PANEL, SHOWCASE } from "./scene/tweaks.js";

const shelf = document.querySelector(".shelf");
const crate = document.querySelector(".crate");
const tracks = [...document.querySelectorAll(".track")];
const canvas = document.getElementById("scene");
const status = document.getElementById("shelf-status");
const ejectButton = document.getElementById("eject");
const compactQuery = matchMedia(COMPACT.query);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const info = document.getElementById("info");
const demoFrame = document.getElementById("demo-frame");
const demoBody = demoFrame?.querySelector("[data-demo-body]");
const demoShot = demoFrame?.querySelector("[data-demo-shot]");
const demoHost = demoFrame?.querySelector("[data-demo-host]");
const lineLayer = document.getElementById("callout-lines");
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
  const width = panelWidth();
  info.style.cssText = [
    `left: ${viewport - width - PANEL.margin - shelfRect.left}px`,
    `top: ${crateRect.top - shelfRect.top}px`,
    `width: ${width}px`,
    `height: ${crateRect.height}px`,
  ].join(";");
}

const panelWidth = () => Math.min(PANEL.maxWidth, document.documentElement.clientWidth * PANEL.widthFraction);

// ---- The showcase demo frame -------------------------------------------------
// A placeholder window between the left stack and the info panel (never overlapping the panel).
// It is laid out at its final size; the scene's showcase progress only drives its transform
// (it grows from its right edge) and opacity.
function placeFrame() {
  if (!demoFrame || compactQuery.matches) return;
  const F = SHOWCASE.frame;
  const viewport = document.documentElement.clientWidth;
  const left = viewport * F.left;
  const right = viewport - panelWidth() - PANEL.margin - F.gap; // stays clear of the info panel
  const width = Math.max(0, Math.min(viewport * F.widthFraction, right - left));
  const shelfRect = shelf.getBoundingClientRect();
  const crateRect = crate.getBoundingClientRect();
  demoFrame.style.left = `${left + (right - left - width) / 2 - shelfRect.left}px`;
  demoFrame.style.top = `${crateRect.top - shelfRect.top + F.top}px`;
  demoFrame.style.width = `${width}px`;
  demoFrame.style.height = `${width / F.aspect}px`;
}

// Called by the scene as the showcase moves (0 = the normal playing layout, 1 = the showcase)
function onShowcase(progress) {
  if (!demoFrame) return;
  // The lines draw once the frame has finished growing, and fade out as soon as it starts to leave
  if (progress < 0.999) hideCallouts();
  const F = SHOWCASE.frame;
  const reduce = reducedMotion();
  const visible = progress > 0.001 && !compactQuery.matches;
  if (visible && demoFrame.hidden) {
    demoFrame.hidden = false;
    placeFrame();
  }
  if (!visible) {
    demoFrame.hidden = true;
    return;
  }
  if (reduce) {
    demoFrame.style.transform = "none"; // no slide or scale, only the opacity changes (with a short CSS transition)
    demoFrame.style.opacity = String(Math.min(1, progress * 2));
  } else {
    demoFrame.style.transform = `translateX(${(1 - progress) * F.slide}px) scale(${F.fromScale + (1 - F.fromScale) * progress})`;
    demoFrame.style.opacity = String(Math.min(1, progress * 1.6));
  }
  if (progress >= 0.999) showCallouts();
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

// ---- The screenshot in the demo frame ---------------------------------------
// public/demos/<slug>.png for the active project, loaded only when that record is picked. Two
// stacked images let it crossfade into the next one; if the file is missing the frame keeps its
// "Demo placeholder" text (no broken-image icon).
const demoImgs = [];
let demoFront = null;
let demoToken = 0;
const dots = [];

function setUpDemo() {
  if (!demoFrame || !demoBody || !demoShot) return;
  const root = document.documentElement.style;
  root.setProperty("--image-fade", `${CALLOUTS.imageFade}s`);
  root.setProperty("--dot-size", `${CALLOUTS.dotSize}px`);
  root.setProperty("--dot-hot-scale", String(CALLOUTS.dotHotScale));
  root.setProperty("--line-opacity", String(CALLOUTS.lineOpacity));
  root.setProperty("--line-hot-opacity", String(CALLOUTS.lineHotOpacity));

  for (let i = 0; i < 2; i++) {
    const img = document.createElement("img");
    img.className = "demo-img";
    img.alt = "";
    img.decoding = "async";
    demoShot.append(img);
    demoImgs.push(img);
  }
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "hotspot";
    dot.setAttribute("aria-hidden", "true");
    dot.hidden = true;
    demoBody.append(dot);
    dots.push(dot);
  }

  // Dev only: click the screenshot to print a hotspot to paste into src/projects.js
  if (import.meta.env.DEV) {
    demoBody.addEventListener("click", (e) => {
      const r = demoBody.getBoundingClientRect();
      const x = Math.round(((e.clientX - r.left) / r.width) * 100) / 100;
      const y = Math.round(((e.clientY - r.top) / r.height) * 100) / 100;
      console.log(`hotspot { x: ${x}, y: ${y} }`);
    });
  }

  // A screenshot that is missing in the page (the narrow-screen panel, the list view) is just hidden
  document.addEventListener("error", (e) => hideIfBrokenShot(e.target), true);
  document.querySelectorAll("img.shot").forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) hideIfBrokenShot(img);
  });
}

function hideIfBrokenShot(el) {
  if (el instanceof HTMLImageElement && el.classList.contains("shot")) el.hidden = true;
}

function loadDemo(index) {
  const panel = panels[index];
  if (!panel || !demoBody) return;
  const token = ++demoToken;
  if (demoHost) demoHost.textContent = panel.dataset.host || "";
  setHotspots(panel);

  const url = `/demos/${panel.dataset.slug}.png`;
  const probe = new Image();
  probe.decoding = "async";
  probe.onload = () => token === demoToken && showDemoImage(url, `Screenshot of ${titles[index]}`);
  probe.onerror = () => token === demoToken && showDemoPlaceholder();
  probe.src = url;
}

function showDemoImage(url, alt) {
  const incoming = demoImgs.find((img) => img !== demoFront) ?? demoImgs[0];
  incoming.alt = alt;
  incoming.src = url;
  // Crossfade if the frame is on screen; if it is hidden (a swap leaves the showcase first) just switch
  const instant = !demoFrame || demoFrame.hidden;
  if (instant) demoShot.classList.add("no-fade");
  demoFront?.classList.remove("is-front");
  incoming.classList.add("is-front");
  demoFront = incoming;
  if (instant) {
    void demoShot.offsetWidth; // apply the switch before the fade comes back
    demoShot.classList.remove("no-fade");
  }
  demoBody.dataset.state = "image";
}

function showDemoPlaceholder() {
  demoFront?.classList.remove("is-front");
  demoFront = null;
  if (demoBody) demoBody.dataset.state = "placeholder";
}

function setHotspots(panel) {
  let spots = [];
  try {
    spots = JSON.parse(panel.dataset.hotspots || "[]");
  } catch {
    /* no hotspots */
  }
  dots.forEach((dot, i) => {
    const s = spots[i];
    dot.hidden = !s;
    if (s) {
      dot.style.left = `${s.x * 100}%`;
      dot.style.top = `${s.y * 100}%`;
    }
  });
}

// ---- Callouts: lines from the dots to the notes -----------------------------
// One SVG over the page (fixed, no pointer events). The endpoints come from getBoundingClientRect
// of each dot and note, redone on resize, scroll, a size change of the frame or the panel, and
// when the project changes. The lines draw with stroke-dashoffset (pathLength 1, so a resize
// never breaks them) and each note fades in as its line arrives.
const SVG_NS = "http://www.w3.org/2000/svg";
let calloutsOn = false;
let calloutsEpoch = 0;
let notes = [];
let paths = [];
let calloutsAbort = null;
let calloutsObserver = null;

function showCallouts() {
  if (calloutsOn || compactQuery.matches || picked < 0 || !lineLayer || !demoFrame || demoFrame.hidden) return;
  const panel = panels[picked];
  if (!panel || panel.hidden) return;
  cleanCallouts(); // anything still fading out from before
  const epoch = ++calloutsEpoch;
  calloutsOn = true;
  notes = [...panel.querySelectorAll(".callout-note")];
  shelf.dataset.callouts = "on";
  demoBody.classList.add("callouts-on");

  paths = notes.map(() => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("pathLength", "1");
    path.style.strokeDasharray = "1";
    lineLayer.append(path);
    return path;
  });
  layoutCallouts();

  // Highlight a note, its dot and its line together (hover or keyboard focus on either end)
  calloutsAbort = new AbortController();
  const { signal } = calloutsAbort;
  const hot = (i, on) => {
    notes[i]?.classList.toggle("is-hot", on);
    dots[i]?.classList.toggle("is-hot", on);
    paths[i]?.classList.toggle("is-hot", on);
  };
  notes.forEach((note, i) => {
    for (const type of ["pointerenter", "focus"]) note.addEventListener(type, () => hot(i, true), { signal });
    for (const type of ["pointerleave", "blur"]) note.addEventListener(type, () => hot(i, false), { signal });
    dots[i].addEventListener("pointerenter", () => hot(i, true), { signal });
    dots[i].addEventListener("pointerleave", () => hot(i, false), { signal });
  });

  // Anything that changes where a dot or a note is
  calloutsObserver = new ResizeObserver(() => epoch === calloutsEpoch && layoutCallouts());
  calloutsObserver.observe(demoFrame);
  calloutsObserver.observe(panel);

  if (reducedMotion()) return; // lines and dots appear at once, no drawing
  const C = CALLOUTS;
  notes.forEach((note, i) => {
    const delay = i * C.stagger * 1000;
    paths[i].animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: C.drawDuration * 1000,
      delay,
      easing: "ease-out",
      fill: "both",
    });
    note.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: C.noteFade * 1000,
      delay: delay + C.drawDuration * 1000 * 0.7, // as its line arrives
      fill: "both",
    });
    dots[i].style.setProperty("--delay", `${delay}ms`);
    dots[i].classList.add("pulse"); // pulses once as it appears
  });
}

function hideCallouts({ instant = false } = {}) {
  if (!calloutsOn) return;
  calloutsOn = false;
  const epoch = ++calloutsEpoch;
  calloutsObserver?.disconnect();
  if (instant || reducedMotion()) {
    cleanCallouts();
    return;
  }
  // Fade the lines, dots and notes out (the frame only starts to shrink slowly)
  const ms = CALLOUTS.fadeOutDuration * 1000;
  lineLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" });
  notes.forEach((note) => note.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" }));
  demoBody.classList.remove("callouts-on");
  setTimeout(() => epoch === calloutsEpoch && cleanCallouts(), ms + 30);
}

function cleanCallouts() {
  calloutsAbort?.abort();
  calloutsAbort = null;
  calloutsObserver?.disconnect();
  lineLayer?.getAnimations().forEach((a) => a.cancel());
  lineLayer?.replaceChildren();
  notes.forEach((note) => {
    note.getAnimations().forEach((a) => a.cancel());
    note.classList.remove("is-hot");
  });
  dots.forEach((dot) => dot.classList.remove("pulse", "is-hot"));
  demoBody?.classList.remove("callouts-on");
  shelf.dataset.callouts = "off";
  notes = [];
  paths = [];
}

let layoutQueued = false;
function layoutCallouts() {
  if (!calloutsOn || layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    if (!calloutsOn) return;
    const C = CALLOUTS;
    notes.forEach((note, i) => {
      const dot = dots[i];
      if (!dot || dot.hidden || !paths[i]) return;
      const a = dot.getBoundingClientRect();
      const b = note.getBoundingClientRect();
      const x0 = a.left + a.width / 2;
      const y0 = a.top + a.height / 2;
      const x3 = b.left - C.noteGap; // ends just before the note's left edge, level with its title
      const y3 = b.top + Math.min(b.height / 2, 16);
      const x1 = x3 - C.elbow;
      // one diagonal, then a short horizontal run into the note (a straight line if the dot is too far right)
      paths[i].setAttribute("d", x1 > x0 ? `M${x0} ${y0} L${x1} ${y3} L${x3} ${y3}` : `M${x0} ${y0} L${x3} ${y3}`);
    });
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
    // Only the record that is about to play gets its screenshot loaded (not on an eject)
    if (!(previous === "playing" && index === picked)) loadDemo(index);
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
  compactQuery.addEventListener("change", () => {
    render();
    placePanel();
    if (compactQuery.matches) {
      hideCallouts({ instant: true });
      if (demoFrame) demoFrame.hidden = true;
    }
  });
  window.addEventListener("resize", () => {
    placePanel();
    placeFrame();
    layoutCallouts();
  });
  window.addEventListener("scroll", layoutCallouts, { passive: true }); // the lines are fixed, the page is not
  setUpDemo();

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
      onShowcase,
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
  hideCallouts({ instant: true });
  // Nothing of a playing record may be left behind for the next visit
  panels.forEach((panel) => (panel.hidden = true));
  if (demoFrame) demoFrame.hidden = true;
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