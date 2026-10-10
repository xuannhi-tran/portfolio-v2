// The Projects section: the 3D scene (a row of sleeves) and the controls around it.
// three.js and gsap are imported only when the section is about to be reached, so the hero stays light.
// The canvas is a fixed full-viewport layer that is hidden (and its render loop stopped) unless this
// section is on screen: it shows once ROW.enterAt of the section is visible (the sleeves then spread out
// from a pile once) and fades out when less than ROW.leaveAt is.
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

import { COMPACT, DEMO_IMAGE, LIST_MODE, LIVE_DEMO, PANEL, PLAYER, ROW, SHOWCASE, SWAP_IN_PLACE } from "./scene/tweaks.js";
import { rowMetrics, rowHeight } from "./scene/rowLayout.js";

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
const demoBar = demoFrame?.querySelector(".demo-bar");
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
let navClosing = false; // a nav link is closing the record: no history entry, no snap back to the row, no focus return
let closeWaiters = []; // resolved when the row is back
let scene = null;
let creating = false; // the scene is being built
let transitionStart = 0;

const titles = tracks.map((t) => t.querySelector(".track-title").textContent);
const shortTitles = tracks.map((t, i) => t.dataset.short || titles[i]);
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
    // Under the turntable (its size follows the column's width, not its height): the player across the content column, then
    // the thumbnails of the other records. The "All records" pill sits at the column's top (it scrolls with the page here).
    const shelfRect = shelf.getBoundingClientRect();
    const crateTop = crate.getBoundingClientRect().top - shelfRect.top;
    const cs = getComputedStyle(shelf);
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const columnWidth = shelf.clientWidth - padLeft - (parseFloat(cs.paddingRight) || 0);
    const playerTop = COMPACT.topSpace + w * COMPACT.playerAt;
    placePlayer(padLeft, crateTop + playerTop, columnWidth);
    shelf.style.setProperty("--pill-top", `${Math.round(crateTop + COMPACT.pillOffset)}px`);
    const thumbsTop = playerTop + (player?.offsetHeight ?? 0) + COMPACT.playerGap;
    const row = crate.querySelector(".thumbs");
    if (row) row.style.top = `${thumbsTop}px`;
    const free = h - (thumbsTop + thumbSize); // empty space left under the thumbnails in the crate
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
// A window between the left stack and the info panel (never overlapping the panel), holding the
// screenshot. Its body takes the screenshot's shape (frameAspect, clamped), so nothing is cropped; the
// width stays as wide as the slot allows and only shrinks if the height would not fit the viewport.
// It is laid out at its final size; the scene's showcase progress only drives its transform
// (it grows from its right edge) and opacity.
let frameAspect = SHOWCASE.frame.aspect;
let pageScrolling = false; // a scroll is under way (the pick scrolls the scene into place)
window.addEventListener("scroll", () => (pageScrolling = true), { passive: true });
window.addEventListener("scrollend", () => (pageScrolling = false));

function placeFrame() {
  if (!demoFrame || compactQuery.matches || liveExpanded) return;
  const F = SHOWCASE.frame;
  const viewport = document.documentElement.clientWidth;
  const left = viewport * F.left;
  const right = viewport - panelWidth() - PANEL.margin - F.gap; // stays clear of the info panel
  const slot = Math.max(0, Math.min(viewport * F.widthFraction, right - left));
  const chrome = (demoBar?.offsetHeight || 32) + 2; // title bar + the frame's border
  const maxHeight = window.innerHeight * F.maxHeight;

  // Everything below is measured in the section's own coordinates (an element's top minus the section's top), so it
  // does not depend on where the page is scrolled right now: a pick scrolls the scene into place while it plays.
  const shelfRect = shelf.getBoundingClientRect();
  const crateRect = crate.getBoundingClientRect();
  const inShelf = (el) => el.getBoundingClientRect().top - shelfRect.top;
  const crateTop = crateRect.top - shelfRect.top;
  // The first line of the info panel (the panel sits where placePanel() puts it: level with the crate)
  const panelTop = crateTop + (parseFloat(getComputedStyle(panels[0] ?? info).paddingTop) || 0);
  // The "All records" row is sticky, so its place depends on the scroll. Once the scene is in place the crate is
  // centred on screen: the section's top is then at finalTop, and the row sits at its sticky offset or its own place.
  const rowEl = document.querySelector(".shelf-top");
  const margin = parseFloat(getComputedStyle(crate).scrollMarginTop) || 0; // scrollIntoView centres the crate plus its scroll margin
  const pageY = shelfRect.top + window.scrollY; // the section's top, in the page
  const wanted = pageY + crateTop - margin + (crateRect.height + margin) / 2 - window.innerHeight / 2; // scroll position that centres it
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  // where the section's top is, or (while the page is still scrolling into place) will be, on screen: always the place the pick
  // scrolls to, never wherever the page happens to be (a script, or the visitor, may have moved it: the frame and the player must
  // not be laid out for that, or they end up below the section)
  // (while the page is locked where the pick put it, that place itself is the answer: the estimate is a few px off)
  const finalTop = !pageScrolling && lockedY !== null && !compactQuery.matches ? shelfRect.top : pageY - Math.min(Math.max(wanted, 0), maxScroll);
  const stuckBottom = (parseFloat(getComputedStyle(rowEl).top) || 0) + rowEl.offsetHeight; // screen px
  const naturalBottom = (parseFloat(getComputedStyle(shelf).paddingTop) || 0) + rowEl.offsetHeight; // section px
  const rowBottom = Math.max(naturalBottom, stuckBottom - finalTop);
  // The frame and the player under it stay inside the window once the scene is in place
  const playerH = player ? player.offsetHeight + PLAYER.gap : 0;
  const viewBottom = window.innerHeight - finalTop - F.bottomGap; // the window's bottom, in section px
  const alignedTop = Math.max(panelTop, rowBottom + F.rowGap);
  const room = Math.min(maxHeight, viewBottom - playerH - alignedTop);

  let width = slot;
  let height = width / frameAspect + chrome;
  let top = alignedTop;
  if (room >= (slot / frameAspect + chrome) * F.minFit || room >= height) {
    // Level with the panel; shrink the width rather than overflow
    if (height > room) {
      height = room;
      width = (height - chrome) * frameAspect;
    }
  } else {
    // Too short for that: the old centred position
    if (height > maxHeight) {
      height = maxHeight;
      width = (height - chrome) * frameAspect;
    }
    const reference = Math.min(slot / F.aspect + chrome, maxHeight);
    top = crateTop + F.top + Math.max(0, (reference - height) / 2);
  }
  // The player under the frame must stay inside the window too (the centred fallback above does not look at it): shrink the frame to fit
  const lowest = viewBottom - playerH;
  if (top + height > lowest) {
    height = Math.max(chrome + 120, lowest - top);
    width = Math.min(width, (height - chrome) * frameAspect);
  }
  const frameLeft = left + (right - left - width) / 2 - shelfRect.left;
  demoFrame.style.left = `${frameLeft}px`;
  demoFrame.style.top = `${top}px`;
  demoFrame.style.width = `${width}px`;
  demoFrame.style.height = `${height}px`;
  placePlayer(frameLeft, top + height + PLAYER.gap, width);
}

// ---- The mini player ---------------------------------------------------------------
// Under the demo frame on side-by-side layouts (placed with it), after the panel in the page flow on stacked ones. Pause stops the
// record's turn and the bar; previous / next play the neighbouring project (wrapping), through the same path as the other
// records' buttons. It fades with the panel. No audio.
const player = shelf.querySelector("[data-player]");
const playerToggle = player?.querySelector("[data-player-toggle]");
const playerFill = player?.querySelector(".player-fill");
let playerPaused = false;
let playerSwap = false; // the last swap came from the player: focus stays on its button
const projectCount = () => slugs.length;

function placePlayer(left, top, width) {
  if (!player) return;
  player.classList.add("is-placed");
  player.style.left = `${left}px`;
  player.style.top = `${top}px`;
  player.style.width = `${width}px`;
}
function setPaused(paused) {
  playerPaused = paused;
  scene?.setPaused(paused);
  player?.classList.toggle("is-paused", paused);
  playerToggle?.setAttribute("aria-pressed", String(paused));
  playerToggle?.setAttribute("aria-label", paused ? "Play" : "Pause");
}

// A record has just been chosen: playing (paused with reduced motion, where nothing turns anyway), the bar from the start.
// Switching from one open record to another keeps the pause state.
function resetPlayer({ keepPaused = false } = {}) {
  if (!keepPaused) setPaused(reducedMotion());
  if (playerFill) {
    playerFill.style.animation = "none";
    void playerFill.offsetWidth; // restart the sweep
    playerFill.style.animation = "";
  }
}

function playerStep(step) {
  if (uiState !== "playing" || picked < 0) return;
  playerSwap = true;
  requestPick((picked + step + projectCount()) % projectCount());
}

function setUpPlayer() {
  if (!player) return;
  player.style.setProperty("--player-loop", `${PLAYER.loop}s`);
  playerToggle?.addEventListener("click", () => setPaused(!playerPaused));
  player.querySelector("[data-player-prev]")?.addEventListener("click", () => playerStep(-1));
  player.querySelector("[data-player-next]")?.addEventListener("click", () => playerStep(1));
  player.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    playerStep(step);
  });
  const sync = () => (compactQuery.matches ? placePanel() : placeFrame());
  compactQuery.addEventListener("change", sync);
  sync();
}

// Called by the scene as the showcase moves (0 = the normal playing layout, 1 = the showcase)
function onShowcase(progress) {
  if (!demoFrame) return;
  if (progress < 0.999) endLive(); // the live demo is taken down completely before the frame shrinks
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
}

// Called by the scene while a record's panel fades in or out (amount 0..1)
function onPanel(index, amount) {
  const reduce = reducedMotion();
  player?.style.setProperty("--player-o", String(index >= 0 ? amount : 0));
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

// ---- The live demo -----------------------------------------------------------
// "Try it live" (only for projects with liveEnabled) mounts the project's site in an iframe on top of
// the screenshot, after a click and never before. The page is laid out at LIVE_DEMO.virtualWidth and
// scaled to fit the frame, so it stays crisp when the frame resizes and never reloads. EXPAND resizes
// the same frame element in place (the iframe is never moved or re-created, or it would reload).
// The iframe is removed completely whenever the demo ends (back to the screenshot, eject, swap, a new
// project, leaving the shelf, the showcase leaving).
const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
let liveMode = "off"; // "off" | "loading" | "on"
let liveExpanded = false;
let liveUrl = ""; // the active project's live demo, or "" if it has none (or it is switched off)
let liveIframe = null;
let liveTimer = 0;
let liveObserver = null;
let expandTween = null;
let backdrop = null;
let liveStart;
let liveOpen;
let liveExpand;
let liveBack;
let liveLayer;
let liveStage;
let liveLoading;
let liveSlow;
let liveSlowLink;
let demoNote;
const htmlElement = document.documentElement;
const gsapReady = () => import("gsap").then((m) => m.default);

function setUpLive() {
  if (!demoFrame) return;
  liveStart = demoFrame.querySelector("[data-live-start]");
  liveOpen = demoFrame.querySelector("[data-live-open]");
  liveExpand = demoFrame.querySelector("[data-live-expand]");
  liveBack = demoFrame.querySelector("[data-live-back]");
  liveLayer = demoFrame.querySelector("[data-demo-live]");
  liveStage = demoFrame.querySelector("[data-demo-stage]");
  liveLoading = demoFrame.querySelector("[data-demo-loading]");
  liveSlow = demoFrame.querySelector("[data-demo-slow]");
  liveSlowLink = demoFrame.querySelector("[data-live-open-slow]");
  demoNote = document.getElementById("demo-note");
  document.documentElement.style.setProperty("--live-fade", `${LIVE_DEMO.fadeIn}s`);

  backdrop = document.createElement("div");
  backdrop.className = "demo-backdrop";
  backdrop.hidden = true;
  backdrop.addEventListener("click", () => collapseLive());
  shelf.append(backdrop);

  liveStart.addEventListener("click", startLive);
  liveBack.addEventListener("click", () => endLive({ returnFocus: true }));
  liveExpand.addEventListener("click", () => (liveExpanded ? collapseLive() : expandLive()));
  updateLiveButtons();
}

// Which buttons show: "Try it live" when idle (and the project has a live demo); the other three while live
function updateLiveButtons() {
  if (!liveStart) return;
  const idle = liveMode === "off";
  liveStart.hidden = !(idle && liveUrl);
  liveOpen.hidden = idle;
  liveExpand.hidden = idle;
  liveBack.hidden = idle;
  for (const link of [liveOpen, liveSlowLink]) {
    if (!link) continue;
    if (liveUrl) link.href = liveUrl;
    else link.removeAttribute("href"); // never a dead "#" link
  }
  liveExpand.textContent = liveExpanded ? "Collapse" : "Expand";
  liveExpand.setAttribute("aria-expanded", String(liveExpanded));
}

function startLive() {
  if (liveMode !== "off" || !liveUrl || !demoFrame || demoFrame.hidden || compactQuery.matches) return;
  liveMode = "loading";
  shelf.dataset.live = "on"; // the 3D canvas ignores the pointer meanwhile
  htmlElement.classList.add("demo-live"); // the page behind does not scroll (a wheel over the demo cannot chain into it)
  lockedY ??= window.scrollY;

  const iframe = document.createElement("iframe");
  iframe.className = "demo-iframe";
  iframe.title = `Live demo of ${titles[picked] ?? "the project"}`;
  iframe.setAttribute("sandbox", IFRAME_SANDBOX);
  iframe.referrerPolicy = "no-referrer-when-downgrade";
  iframe.addEventListener("load", () => {
    if (iframe !== liveIframe) return;
    liveMode = "on";
    clearTimeout(liveTimer);
    liveSlow.hidden = true;
    liveLoading.classList.add("is-done");
    iframe.classList.add("is-loaded");
    setTimeout(() => iframe === liveIframe && (liveLoading.hidden = true), 350);
  });
  liveIframe = iframe;
  iframe.src = liveUrl;
  liveStage.append(iframe);

  liveLayer.hidden = false;
  liveLoading.hidden = false;
  liveLoading.classList.remove("is-done");
  liveSlow.hidden = true;
  fitLive();
  liveObserver = new ResizeObserver(fitLive);
  liveObserver.observe(demoBody);
  // Blocked or refused frames cannot be detected reliably, so after a while show a hint (and the
  // "Open in new tab" link in the title bar is there the whole time)
  liveTimer = setTimeout(() => {
    if (liveMode === "loading") liveSlow.hidden = false;
  }, LIVE_DEMO.slowAfter * 1000);

  updateLiveButtons();
  placeNote();
  liveBack.focus({ preventScroll: true }); // the start button just went away
}

// Lay the page out at the virtual width and scale it to fit the frame body (the height follows its shape)
function fitLive() {
  if (!liveIframe) return;
  const w = demoBody.clientWidth;
  const h = demoBody.clientHeight;
  if (!w || !h) return;
  const scale = w / LIVE_DEMO.virtualWidth;
  liveIframe.style.width = `${LIVE_DEMO.virtualWidth}px`;
  liveIframe.style.height = `${h / scale}px`;
  liveIframe.style.transform = `scale(${scale})`;
}

// Takes the demo down completely. returnFocus: back to the screenshot by the visitor, so focus goes to "Try it live".
function endLive({ returnFocus = false } = {}) {
  if (liveMode === "off") return;
  clearTimeout(liveTimer);
  liveObserver?.disconnect();
  liveObserver = null;
  if (liveExpanded) collapseLive({ instant: true });
  if (liveIframe) {
    liveIframe.src = "about:blank";
    liveIframe.remove();
    liveIframe = null;
  }
  liveStage.replaceChildren();
  liveMode = "off";
  liveLayer.hidden = true;
  liveSlow.hidden = true;
  delete shelf.dataset.live;
  htmlElement.classList.remove("demo-live");
  if (demoNote) demoNote.hidden = true;
  updateLiveButtons();
  if (returnFocus) liveStart.focus({ preventScroll: true });
}

// The optional liveNote caption, under the frame
function placeNote() {
  if (!demoNote) return;
  const text = panels[picked]?.dataset.liveNote ?? "";
  demoNote.hidden = !(text && liveMode !== "off" && !liveExpanded);
  if (demoNote.hidden) return;
  demoNote.textContent = text;
  const f = demoFrame.getBoundingClientRect();
  const s = shelf.getBoundingClientRect();
  demoNote.style.left = `${f.left - s.left}px`;
  demoNote.style.top = `${f.bottom - s.top + 10}px`;
}

function expandedBox() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const width = vw * LIVE_DEMO.expandWidth;
  const height = vh * LIVE_DEMO.expandHeight;
  return { left: (vw - width) / 2, top: (vh - height) / 2, width, height };
}

function applyExpandedBox() {
  const b = expandedBox();
  Object.assign(demoFrame.style, {
    left: `${b.left}px`,
    top: `${b.top}px`,
    width: `${b.width}px`,
    height: `${b.height}px`,
  });
}

// Grows the frame in place. FLIP: the frame jumps to its final size, then a GSAP transform eases it
// from where it was. The same element keeps its iframe, so nothing reloads.
async function expandLive() {
  if (liveMode === "off" || liveExpanded) return;
  const reduce = reducedMotion();
  const gsap = reduce ? null : await gsapReady();
  if (liveMode === "off" || liveExpanded) return;
  liveExpanded = true;
  const first = demoFrame.getBoundingClientRect();
  expandTween?.kill();
  demoFrame.classList.add("is-expanded");
  applyExpandedBox();
  backdrop.hidden = false;
  updateLiveButtons();
  placeNote();
  if (!gsap) {
    demoFrame.style.transform = "none";
    backdrop.style.opacity = String(LIVE_DEMO.backdropOpacity);
    return;
  }
  const last = demoFrame.getBoundingClientRect();
  gsap.set(demoFrame, { transformOrigin: "0 0" });
  expandTween = gsap.fromTo(
    demoFrame,
    { x: first.left - last.left, y: first.top - last.top, scaleX: first.width / last.width, scaleY: first.height / last.height },
    {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      duration: LIVE_DEMO.expandDuration,
      ease: LIVE_DEMO.expandEase,
      onComplete: () => gsap.set(demoFrame, { clearProps: "transform,transformOrigin" }),
    },
  );
  gsap.to(backdrop, { opacity: LIVE_DEMO.backdropOpacity, duration: LIVE_DEMO.expandDuration, ease: "power2.out" });
}

async function collapseLive({ instant = false } = {}) {
  if (!liveExpanded) return;
  const reduce = reducedMotion();
  const first = demoFrame.getBoundingClientRect();
  liveExpanded = false;
  expandTween?.kill();
  const restore = () => {
    demoFrame.classList.remove("is-expanded");
    demoFrame.style.transform = "none";
    placeFrame(); // back to the normal left / top / width / height
  };
  updateLiveButtons();
  if (instant || reduce) {
    restore();
    backdrop.hidden = true;
    backdrop.style.opacity = "0";
    placeNote();
    return;
  }
  const gsap = await gsapReady();
  restore();
  const last = demoFrame.getBoundingClientRect();
  gsap.set(demoFrame, { transformOrigin: "0 0" });
  expandTween = gsap.fromTo(
    demoFrame,
    { x: first.left - last.left, y: first.top - last.top, scaleX: first.width / last.width, scaleY: first.height / last.height },
    {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      duration: LIVE_DEMO.expandDuration,
      ease: LIVE_DEMO.expandEase,
      onComplete: () => {
        gsap.set(demoFrame, { clearProps: "transform,transformOrigin" });
        placeNote();
      },
    },
  );
  gsap.to(backdrop, {
    opacity: 0,
    duration: LIVE_DEMO.expandDuration,
    ease: "power2.out",
    onComplete: () => (backdrop.hidden = true),
  });
}

// ---- The screenshot in the demo frame ---------------------------------------
// public/demos/<slug>.png for the active project, loaded only when that record is picked. Two
// stacked images let it crossfade into the next one; if the file is missing the frame keeps its
// "Demo placeholder" text (no broken-image icon).
const demoImgs = [];
let demoFront = null;
let demoToken = 0;

function setUpDemo() {
  if (!demoFrame || !demoBody || !demoShot) return;
  const root = document.documentElement.style;
  root.setProperty("--image-fade", `${DEMO_IMAGE.fade}s`);

  for (let i = 0; i < 2; i++) {
    const img = document.createElement("img");
    img.className = "demo-img";
    img.alt = "";
    img.decoding = "async";
    demoShot.append(img);
    demoImgs.push(img);
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

// Puts a project's screenshot (and its address in the title bar) in the frame. Resolves once the picture is in (or its placeholder).
// instant: no crossfade (the frame is out of sight, or the page is jumping straight to a record)
function loadDemo(index, { instant = false } = {}) {
  const panel = panels[index];
  if (!panel || !demoBody) return Promise.resolve();
  endLive(); // a newly picked project always starts on its screenshot
  liveUrl = panel.dataset.liveUrl || "";
  updateLiveButtons();
  const token = ++demoToken;
  if (demoHost) demoHost.textContent = panel.dataset.host || "";

  const url = `/demos/${panel.dataset.slug}.png`;
  const probe = new Image();
  probe.decoding = "async";
  return new Promise((resolve) => {
    probe.onload = () => {
      if (token === demoToken) showDemoImage(url, `Screenshot of ${titles[index]}`, probe.naturalWidth, probe.naturalHeight, instant);
      resolve();
    };
    probe.onerror = () => {
      if (token === demoToken) showDemoPlaceholder();
      resolve();
    };
    probe.src = url;
  });
}

function showDemoImage(url, alt, width, height, forceInstant = false) {
  const incoming = demoImgs.find((img) => img !== demoFront) ?? demoImgs[0];
  incoming.alt = alt;
  incoming.src = url;
  // Crossfade if the frame is on screen; if it is hidden (a swap leaves the showcase first) just switch
  const instant = forceInstant || !demoFrame || demoFrame.hidden || shelf.classList.contains("is-swapping");
  if (instant) demoShot.classList.add("no-fade");
  demoFront?.classList.remove("is-front");
  incoming.classList.add("is-front");
  demoFront = incoming;
  if (instant) {
    void demoShot.offsetWidth; // apply the switch before the fade comes back
    demoShot.classList.remove("no-fade");
  }
  demoBody.dataset.state = "image";
  // The frame takes the screenshot's shape (clamped), before it grows in
  frameAspect = width && height ? Math.min(DEMO_IMAGE.maxAspect, Math.max(DEMO_IMAGE.minAspect, width / height)) : SHOWCASE.frame.aspect;
  placeFrame();
}

function showDemoPlaceholder() {
  demoFront?.classList.remove("is-front");
  demoFront = null;
  if (demoBody) demoBody.dataset.state = "placeholder";
  frameAspect = SHOWCASE.frame.aspect;
  placeFrame();
}

// ---- The captions under the sleeves of the row -------------------------------------
// One per project (short title, then the stack, both from src/projects.js through the track buttons). The scene says where
// each sleeve is every frame, since the row moves with the page, and when a caption should be off (a record is picked).
let capsLayer = null;
let caps = [];
const stacks = tracks.map((t) => t.dataset.stack || "");
function buildCaptions() {
  capsLayer = document.createElement("div");
  capsLayer.className = "sleeve-caps";
  capsLayer.setAttribute("aria-hidden", "true"); // the sleeves' own buttons say the same
  caps = tracks.map((_, i) => {
    const el = document.createElement("div");
    el.className = "sleeve-cap";
    const text = document.createElement("div");
    text.className = "cap-text";
    const title = document.createElement("span");
    title.className = "cap-title";
    title.textContent = shortTitles[i];
    text.append(title);
    if (stacks[i]) {
      const stack = document.createElement("span");
      stack.className = "cap-stack";
      stack.textContent = stacks[i];
      text.append(stack);
    }
    el.append(text);
    el._last = "";
    capsLayer.append(el);
    return el;
  });
  shelf.append(capsLayer);
  // A real focus ring (keyboard focus only) round the sleeve and its caption: the focused control is the hidden track button
  tracks.forEach((track, i) => {
    const ring = () => caps[i].classList.toggle("is-focus", usingKeyboard && track.matches(":focus-visible"));
    track.addEventListener("focus", ring);
    track.addEventListener("blur", ring);
  });
}

function showLabel(i, place) {
  const el = caps[i];
  if (!el) return;
  el.classList.toggle("is-on", !!place);
  if (!place) return; // fading out where it is
  const w = Math.round(place.size);
  const key = `${Math.round(place.x - place.size / 2)},${Math.round(place.top)},${w}`;
  if (key === el._last) return;
  el._last = key;
  el.style.width = `${w}px`;
  el.style.setProperty("--lift", `${Math.round(place.lift)}px`); // how far the sleeve rises when focused: the ring reaches over it
  el.style.height = `${w}px`;
  el.style.transform = `translate3d(${Math.round(place.x - place.size / 2)}px, ${Math.round(place.top)}px, 0)`;
}

// ---- Scroll lock -------------------------------------------------------------------
// While a record is picked or playing the page does not scroll (the scene is in the viewport and stays there).
// A pick first scrolls the scene into place; the lock follows once that is done.
// Wide screens: the page does not scroll at all (everything fits). Narrow screens: the panel is taller than the
// screen and must be scrollable, but only within the Projects section, so the page above and below is taken out of the
// flow (display: none) while a record is open: there is nothing to scroll into, no scroll chaining and no scroll
// handlers to fight with. The scroll position is moved by the height that disappears, in the same task, so nothing
// jumps; it is moved back when the record is closed.
let soloShift = 0;
function enterSolo() {
  if (htmlElement.classList.contains("shelf-solo")) return;
  const y = window.scrollY; // read before the page gets shorter (the browser would clamp it)
  const before = shelf.getBoundingClientRect().top + y;
  htmlElement.classList.add("shelf-solo");
  const after = shelf.getBoundingClientRect().top + window.scrollY; // forces the layout
  soloShift = before - after;
  // The panel only joins the page once it has faded in, so for now the section may be too short to scroll to where the
  // scene is (the crate near the top of the screen): hold that much room until the record is closed
  const target = Math.max(0, y - soloShift);
  shelf.style.minHeight = `${Math.max(shelf.offsetHeight, target + window.innerHeight)}px`;
  window.scrollTo({ top: target, behavior: "instant" });
}
function exitSolo() {
  if (!htmlElement.classList.contains("shelf-solo")) return;
  htmlElement.classList.remove("shelf-solo");
  shelf.style.minHeight = "";
  window.scrollTo({ top: window.scrollY + soloShift, behavior: "instant" });
  soloShift = 0;
}
function lockScroll() {
  if (compactQuery.matches) enterSolo();
  else {
    htmlElement.classList.add("shelf-locked");
    lockedY = window.scrollY;
  }
}
function unlockScroll() {
  htmlElement.classList.remove("shelf-locked");
  if (!htmlElement.classList.contains("demo-live")) lockedY = null;
  exitSolo();
}

// ---- The scroll guard ------------------------------------------------------------------------------------------
// With a record open on a wide screen the page is locked (overflow: hidden), which stops the visitor scrolling but not a script:
// an embedded app that scrolls its own message list into view, or focuses its input, moves the TOP page too (a cross-origin
// iframe cannot be told not to). So while the page is locked every scroll that did not follow the visitor's own input is undone
// at once, back to where it was locked. And the lock never traps the visitor: if the page is somewhere outside the open section
// and they try to scroll, the lock (and the live demo) is let go; it is taken up again when they scroll back into the section.
let lockedY = null; // where the page is locked (null: not locked)
let lastInput = 0; // when the visitor last used the wheel, touch, keys or the pointer on the page (not inside an iframe)
for (const type of ["wheel", "touchmove", "keydown", "pointerdown"]) {
  window.addEventListener(type, () => (lastInput = performance.now()), { passive: true, capture: true });
}
const pageLocked = () => !compactQuery.matches && (htmlElement.classList.contains("shelf-locked") || htmlElement.classList.contains("demo-live"));
const sectionHoldsScreen = () => {
  const r = shelf.getBoundingClientRect();
  return r.top < window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.5;
};
function releaseLock() {
  endLive();
  htmlElement.classList.remove("shelf-locked");
  lockedY = null;
}
function setUpScrollGuard() {
  window.addEventListener("scroll", () => {
    if (!pageLocked()) {
      lockedY = null;
      return;
    }
    if (lockedY === null) {
      lockedY = window.scrollY;
      return;
    }
    if (Math.abs(window.scrollY - lockedY) <= 1) return;
    if (performance.now() - lastInput < 150) lockedY = window.scrollY; // the visitor did it (a scrollbar drag, say)
    else window.scrollTo({ top: lockedY, behavior: "instant" }); // a script did it: put it back
  }, { passive: true });
  // Trying to scroll while the page is out of the open section (the lock should not have held it there): let go
  const tryScroll = () => {
    if (uiState === "stack" || !pageLocked() || sectionHoldsScreen()) return;
    releaseLock();
  };
  for (const type of ["wheel", "touchmove", "keydown"]) window.addEventListener(type, tryScroll, { passive: true });
  // ...and take the lock up again when they come back to the open record
  window.addEventListener("scrollend", () => {
    if (uiState !== "playing" || compactQuery.matches || htmlElement.classList.contains("shelf-locked") || pageScrolling) return;
    if (sectionHoldsScreen()) lockScroll();
  });
}
function lockWhenAligned() {
  if (routing || reducedMotion()) {
    lockScroll();
    return;
  }
  const r = crate.getBoundingClientRect();
  const toGo = compactQuery.matches ? r.top - 64 : r.top + r.height / 2 - window.innerHeight / 2;
  if (Math.abs(toGo) < 3) {
    lockScroll();
    return;
  }
  const lock = () => {
    window.removeEventListener("scrollend", lock);
    clearTimeout(timer);
    pageScrolling = false;
    if (uiState !== "stack") {
      lockScroll();
      placePanel();
      placeFrame();
    }
  };
  const timer = setTimeout(lock, 1600); // a smooth scroll normally ends with `scrollend`; this is only a fallback
  window.addEventListener("scrollend", lock, { once: true });
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

  if (status && !shelf.classList.contains("is-swapping")) status.textContent = playing && picked !== -1 ? `Now playing: ${titles[picked]}` : "";
  if (ejectButton) ejectButton.hidden = uiState === "stack";
}

function setActive(i) {
  if (uiState === "transitioning") return;
  active = i;
  render();
  scene?.setActive(i);
}

function requestPick(i) {
  if (!scene || modeTl) return; // not while the row and the list are swapping
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

// Back in the row: the section eases from its open-record height to the row's, so nothing below it jumps
function releaseHeight(fromHeight) {
  const toHeight = shelf.offsetHeight;
  if (!gsapNow || Math.abs(fromHeight - toHeight) < 2) return;
  htmlElement.classList.add("mode-switching"); // no scroll anchoring while the page below changes height
  shelf.style.height = `${fromHeight}px`;
  gsapNow.to(shelf, {
    height: toHeight,
    duration: 0.45,
    ease: LIST_MODE.ease,
    onComplete: () => {
      shelf.style.height = "";
      htmlElement.classList.remove("mode-switching");
    },
  });
}

let swapInTimer = 0;
let swapContentIndex = -1; // an in-place swap is waiting for its HTML to be out of sight before the new record's content goes in
let swapContentReady = Promise.resolve();
// The new record's content in one step, while everything is hidden: the live demo is taken down, the title bar, the screenshot and the
// "Now playing" line change (the panel is the scene's: it shows the new record's panel once the new record starts)
function applySwapContent() {
  if (swapContentIndex < 0) return;
  const i = swapContentIndex;
  swapContentIndex = -1;
  endLive();
  if (status) status.textContent = `Now playing: ${titles[i]}`;
  swapContentReady = loadDemo(i, { instant: true });
}
let ejectAfterSwap = false; // "All records" was pressed while one record was swapping for another
function onStateChange(next, index) {
  const previous = uiState;
  uiState = next;

  // Switching records while one is open (the turntable stays put, the page fades its HTML out and in): the frame, the player and the
  // panel keep showing the OLD record until they are fully hidden; the new record's content goes in once, then (when it is playing)
  // they fade back in
  const inPlaceSwap = previous === "playing" && next === "transitioning" && lastAction === "swap" && !routing && !reducedMotion() && index !== picked;
  if (next !== "playing" && !inPlaceSwap) endLive();
  if (next === "transitioning") {
    transitionStart = performance.now();
    if (lastAction !== "eject") resetPlayer({ keepPaused: lastAction === "swap" }); // a record was chosen: it plays (or stays paused), the bar starts again
    // Switching records while one is open (the turntable stays put): the frame, the player and the panel fade out now and come back
    // when the new record is playing (the scene waits SWAP_IN_PLACE.fadeOut before it starts moving anything)
    if (inPlaceSwap) {
      clearTimeout(swapInTimer);
      shelf.classList.remove("is-swap-in");
      shelf.classList.add("is-swapping");
      swapContentIndex = index;
    }
    active = -1;
    if (!routing && !navClosing) {
      // The URL follows what the user does (picking, swapping and ejecting add history entries)
      const target = hashFor(lastAction === "eject" ? -1 : index);
      if (location.hash !== target) history.pushState(null, "", target);
    }
    // Only the record that is about to play gets its screenshot loaded (not on an eject)
    if (!(previous === "playing" && index === picked) && !inPlaceSwap) loadDemo(index, { instant: routing });
    if (previous === "stack") {
      picked = index;
      // Bring the scene into view: the stack's column, or the top of it on narrow screens
      crate.scrollIntoView({
        block: compactQuery.matches ? "start" : "center",
        behavior: routing || reducedMotion() ? "auto" : "smooth",
      });
      lockWhenAligned();
    }
  }

  if (shelf.classList.contains("is-swapping") && (next === "playing" || next === "stack")) {
    const index0 = swapContentIndex;
    if (next === "playing") {
      applySwapContent(); // (if the swap was skipped before the HTML was out of sight: put the content in now, still hidden)
      const ready = swapContentReady;
      ready.then(() => {
        if (uiState !== "playing" || !shelf.classList.contains("is-swapping")) return;
        shelf.classList.remove("is-swapping");
        shelf.classList.add("is-swap-in"); // (the fade-in transition applies while this class is on)
        swapInTimer = setTimeout(() => shelf.classList.remove("is-swap-in"), SWAP_IN_PLACE.fadeIn * 1000 + 100);
      });
    } else {
      swapContentIndex = -1;
      shelf.classList.remove("is-swapping");
    }
    void index0;
  }
  if (next === "playing" && ejectAfterSwap) {
    ejectAfterSwap = false;
    setTimeout(requestEject, 80); // (after the scene has finished setting the playing state up)
  }
  if (next !== "playing") ejectAfterSwap = ejectAfterSwap && next === "transitioning";
  const wasPicked = picked;
  if (next === "playing") picked = index;
  if (next === "stack") picked = -1;
  if (previous === "stack" && next !== "stack") {
    gsapNow?.killTweensOf(shelf); // a section height still easing back from the last record: the open height applies at once
    shelf.style.height = "";
  }
  const openHeight = next === "stack" && previous !== "stack" ? shelf.offsetHeight : 0;
  render(); // first, so the controls are visible and can take focus
  // The open record has the section's full height at once (CSS), and the scene measures it before the first frame of the move;
  // back in the row the height eases down to the row's while the page settles on the section
  if (previous === "stack" && next !== "stack") scene?.relayout();
  if (openHeight && !routing && !reducedMotion()) releaseHeight(openHeight);
  if (next === "stack") {
    unlockScroll(); // back in the row: the page scrolls again
    // Settle with the heading and the row in view (the pick scrolled the scene into place, narrow screens also moved the page)
    if (!routing && !navClosing && previous !== "stack") {
      shelf.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" });
    }
    const waiters = closeWaiters;
    closeWaiters = [];
    navClosing = false;
    waiters.forEach((resolve) => resolve());
  }

  if (next === "playing") {
    placePanel();
    if (lastAction === "swap" && !routing && playerSwap) {
      if (!player.contains(document.activeElement)) playerToggle?.focus({ preventScroll: true });
    } else if (lastAction === "swap" && !routing) focusNextPlayable(index);
    else panels[index]?.querySelector(".panel-title")?.focus({ preventScroll: true }); // the panel just opened
    playerSwap = false;
  }
  if (next === "stack" && !routing && !navClosing && (document.activeElement.closest?.(".panel") || document.activeElement === ejectButton || document.activeElement === document.body)) {
    // Back where we started: return keyboard focus to the record that was picked
    tracks[wasPicked]?.focus({ preventScroll: true });
  }
}

export const isRecordOpen = () => !!scene && uiState !== "stack";

// Closes the open record with the same reverse timeline as "All records" (a nav link does this before it scrolls).
// Resolves once the row is back and the page is unlocked; nothing else is left to do when it does.
export function closeRecord() {
  return new Promise((resolve) => {
    if (!scene || uiState === "stack") {
      resolve();
      return;
    }
    navClosing = true;
    closeWaiters.push(resolve);
    setTimeout(() => {
      // never leave a link hanging if something goes wrong
      if (closeWaiters.includes(resolve)) {
        closeWaiters = closeWaiters.filter((r) => r !== resolve);
        navClosing = false;
        resolve();
      }
    }, 8000);
    if (uiState === "transitioning") scene.skip(); // finish the move first (a pick goes to playing, an eject to the row)
    if (uiState === "playing") requestEject();
  });
}

// The section's browsing height (--row-h) from the page alone, so it is right before the 3D scene exists (the scene keeps it
// up to date afterwards with the same numbers). Without it the section would shrink when the scene arrives, under a nav scroll.
const gridQuery = matchMedia(COMPACT.gridQuery);
function setRowHeight() {
  const label = shelf.querySelector(".shelf-label");
  if (!label || !crate) return;
  const cs = getComputedStyle(shelf);
  const capSpace = (parseFloat(cs.getPropertyValue("--cap-gap")) || 0) + (parseFloat(cs.getPropertyValue("--cap-h")) || 0);
  const m = rowMetrics({ viewW: htmlElement.clientWidth, viewH: htmlElement.clientHeight, n: tracks.length, grid: gridQuery.matches, capSpace });
  shelf.style.setProperty("--row-h", `${rowHeight(m, { headBottom: label.getBoundingClientRect().bottom, crateTop: crate.getBoundingClientRect().top, capSpace })}px`);
}

// A list thumbnail whose file is missing or fails to load is dropped, and the text takes the whole row
function setUpThumbs() {
  listLayer.querySelectorAll(".row-thumb-img").forEach((img) => {
    const drop = () => img.closest(".row-body")?.classList.add("no-thumb");
    img.addEventListener("error", drop, { once: true });
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) drop();
  });
}

export function initShelf() {
  shelf.style.setProperty("--swap-out", `${SWAP_IN_PLACE.fadeOut}s`);
  shelf.style.setProperty("--swap-in", `${SWAP_IN_PLACE.fadeIn}s`);
  setUpScrollGuard();
  setUpThumbs();
  setUpPlayer();
  setRowHeight();
  window.addEventListener("resize", setRowHeight);
  document.fonts?.ready.then(setRowHeight); // the heading's height settles with the font
  buildPlayControls();
  import("gsap").then((m) => (gsapNow = m.default));
  modeButtons.forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
  if (!webglAvailable()) fallBackToList();

  tracks.forEach((track, i) => wireItem(track, i));
  ejectButton?.addEventListener("click", requestEject);
  compactQuery.addEventListener("change", () => {
    if (uiState !== "stack") {
      unlockScroll();
      lockScroll();
    }
    render();
    placePanel();
    if (compactQuery.matches) {
      endLive();
      if (demoFrame) demoFrame.hidden = true;
    }
  });
  window.addEventListener("resize", () => {
    placePanel();
    placeFrame();
    if (liveExpanded) applyExpandedBox();
    placeNote();
  });
  setUpDemo();
  setUpLive();
  setUpActivation();
  new ResizeObserver(() => {
    placePanel();
    placeFrame();
  }).observe(shelf);
  // The pick scrolls the scene into place while it plays: once that is done, measure everything again
  window.addEventListener("scrollend", () => {
    pageScrolling = false;
    if (uiState === "stack") return;
    placePanel();
    placeFrame();
  });

  buildCaptions();

  // Left / right arrows move along the row (the keyboard path to the sleeves); Enter picks the focused one
  document.querySelector(".tracklist")?.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step || uiState !== "stack") return;
    const i = tracks.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    tracks[Math.max(0, Math.min(tracks.length - 1, i + step))].focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // While a demo is live Escape works in steps: collapse EXPAND, then back to the screenshot, then (next time) eject
    if (liveMode !== "off") {
      if (liveExpanded) collapseLive();
      else endLive({ returnFocus: true });
      return;
    }
    if (!scene) return;
    if (uiState === "playing") requestEject();
    else if (uiState === "transitioning") scene.skip();
  });

  // A click anywhere while it is moving jumps to the end (ignoring the click that started it)
  document.addEventListener("click", (e) => {
    if (uiState === "transitioning" && performance.now() - transitionStart > 150) {
      // "All records" during a swap: finish the swap, then go back (queued)
      if (lastAction === "swap" && e.target.closest?.("#eject")) ejectAfterSwap = true;
      scene?.skip();
    }
  });

  render();
}

// ---- Modes: "records" (the row of sleeves) and "list" (the tracklist rows) -----------------------------
// Both live inside the Projects section, under its heading, one at a time (.shelf-body holds the two layers). The toggle
// on the "Pick a record" line animates the switch (LIST_MODE in tweaks.js); a URL, back and forward and the no-WebGL
// fallback switch at once. Without WebGL only the list exists.
const body = shelf.querySelector("[data-shelf-body]");
const recordsLayer = body.querySelector(".shelf-layout");
const listLayer = body.querySelector("[data-shelf-list]");
const modeButtons = [...shelf.querySelectorAll(".mode-btn")];
const modeLabel = shelf.querySelector(".shelf-label");
const modeLabels = { records: modeLabel?.textContent ?? "", list: "All projects" };
let mode = "records";
let noWebGL = false;
let modeTl = null; // the running animated switch
let modeTarget = null; // ...and the mode it is going to
let shareNow = 0; // how much of the section is on screen (the activation observer)
let gsapNow = null;
const listRows = () => [...listLayer.querySelectorAll(".row")];

export const isListMode = () => mode === "list";

function paintMode(next) {
  mode = next;
  shelf.dataset.mode = next;
  modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === next)));
  if (modeLabel) modeLabel.textContent = modeLabels[next];
}

// The layers as they are at rest: one shown, nothing measured or laid over, the height free again
function settleLayers(next) {
  recordsLayer.hidden = next === "list";
  listLayer.hidden = next !== "list";
  [recordsLayer, listLayer].forEach((l) => l.classList.remove("is-measure", "is-overlay"));
  body.style.height = "";
  body.style.overflow = "";
  listRows().forEach((r) => {
    r.style.opacity = "";
    r.style.transform = "";
  });
  htmlElement.classList.remove("mode-switching");
  shelf.classList.remove("is-switching");
}

// Switch at once (no animation)
function applyMode(next) {
  if (noWebGL) next = "list";
  if (modeTl) {
    modeTl.kill();
    modeTl = null;
    modeTarget = null;
  }
  scene?.fadeRow(false, 0);
  paintMode(next);
  settleLayers(next);
  if (next === "list") hideCanvas({ instant: true });
  else if (shareNow >= ROW.enterAt) showCanvas();
  scene?.relayout();
}

// For the router: a URL, back / forward, the alias #/list. A record that is open is closed first.
export function setMode(next) {
  if (noWebGL) next = "list";
  if (next === "list" && scene && uiState !== "stack") {
    wantedSlug = null;
    routing = true;
    scene.jumpTo(-1);
    routing = false;
  }
  if (next === mode && !modeTl) return;
  applyMode(next);
}

function updateModeHash(next) {
  history.replaceState(null, "", next === "list" ? "#/list" : "#/projects"); // no history entry, no scrolling
}

// The toggle: animated
function switchMode(next) {
  if (noWebGL || uiState !== "stack") return;
  if (next === (modeTl ? modeTarget : mode)) return; // already there, or already on its way
  if (modeTl) modeTl.progress(1); // a switch in progress is finished first (its end state), then the new one starts
  if (reducedMotion() || !scene || !gsapNow) {
    applyMode(next);
    updateModeHash(next);
    return;
  }
  const gsap = gsapNow;
  const T = LIST_MODE;
  const pad = parseFloat(getComputedStyle(body).paddingTop) || 0;
  const incoming = next === "list" ? listLayer : recordsLayer;
  const fromH = body.offsetHeight;
  // How tall the arriving layer is, measured out of the flow (invisible)
  incoming.hidden = false;
  incoming.classList.add("is-measure");
  const toH = incoming.offsetHeight + pad;
  incoming.classList.remove("is-measure");
  incoming.hidden = true;

  htmlElement.classList.add("mode-switching");
  shelf.classList.add("is-switching");
  body.style.height = `${fromH}px`;
  body.style.overflow = "hidden";
  paintMode(next);
  modeTarget = next;
  updateModeHash(next);

  const rows = listRows();
  const done = () => {
    modeTl = null;
    modeTarget = null;
    settleLayers(next);
    if (next === "records") {
      scene.relayout();
      if (shareNow >= ROW.enterAt) showCanvas(); // the sleeves spread out from the pile, as on a first visit
    }
  };
  const tl = gsap.timeline({ onComplete: done });
  modeTl = tl;
  tl.eventCallback("onInterrupt", null);
  if (next === "list") {
    gsap.set(rows, { opacity: 0, y: T.rise });
    scene.fadeRow(true, T.sleevesOut);
    tl.add(() => {
      hideCanvas({ instant: true }); // the render loop stops with the canvas
      recordsLayer.hidden = true;
      listLayer.hidden = false;
      listLayer.classList.add("is-overlay");
    }, T.sleevesOut)
      .to(body, { height: toH, duration: T.height, ease: T.ease }, T.sleevesOut)
      .to(rows, { opacity: 1, y: 0, duration: T.rowDuration, stagger: T.rowStagger, ease: "power2.out" }, T.rowsAt);
  } else {
    tl.to(rows, { opacity: 0, y: T.rise / 2, duration: T.rowsOut, ease: "power1.in" }, 0)
      .add(() => {
        listLayer.hidden = true;
        recordsLayer.hidden = false;
        recordsLayer.classList.add("is-overlay");
      }, T.rowsOut)
      .to(body, { height: toH, duration: T.height, ease: T.ease }, T.rowsOut);
  }
}

function webglAvailable() {
  try {
    const test = document.createElement("canvas");
    return !!(test.getContext("webgl2") || test.getContext("webgl"));
  } catch {
    return false;
  }
}

// No WebGL: the list is the experience. The toggle is hidden, and the rows are plain headings (they cannot open a record).
function fallBackToList() {
  noWebGL = true;
  htmlElement.classList.add("no-3d");
  document.querySelectorAll(".row-head").forEach((a) => a.removeAttribute("href"));
  applyMode("list");
  if (location.hash !== "#/list") history.replaceState(null, "", "#/list");
}

// ---- Showing and hiding the canvas -----------------------------------------------
let canvasOn = false;
let wantCanvas = false;

function showCanvas() {
  if (mode === "list" || modeTl) return; // the list is shown, or a switch will bring the canvas back when it ends
  wantCanvas = true;
  if (!scene || canvasOn) return;
  canvasOn = true;
  canvas.getAnimations().forEach((a) => a.cancel());
  canvas.hidden = false;
  if (!reducedMotion()) canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
  if (uiState === "stack") scene.enterRow(); // the sleeves spread out from the pile
}

function hideCanvas({ instant = false } = {}) {
  wantCanvas = false;
  if (!canvasOn || uiState !== "stack") return; // a record that is playing stays on screen
  canvasOn = false;
  const done = () => {
    if (canvasOn) return;
    canvas.hidden = true; // display: none, so the scene's own observer stops its render loop
    scene?.resetRow(); // the pile again, for the next time
  };
  canvas.getAnimations().forEach((a) => a.cancel());
  if (instant || reducedMotion()) {
    done();
    return;
  }
  const fade = canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ROW.fadeOut * 1000, fill: "forwards" });
  fade.finished.then(
    () => {
      done();
      fade.cancel();
    },
    () => {},
  );
}

// How much of the section is on screen: the share of the smaller of the section and the viewport
function visibleShare(entry) {
  const height = Math.min(entry.boundingClientRect.height, entry.rootBounds?.height ?? window.innerHeight);
  return height ? entry.intersectionRect.height / height : 0;
}

function setUpActivation() {
  if (!shelf || !canvas) return;
  canvas.hidden = true;
  new IntersectionObserver(
    (entries) => {
      const share = visibleShare(entries[entries.length - 1]);
      shareNow = share;
      if (share >= ROW.enterAt) {
        enterShelf();
        showCanvas();
      } else if (share < ROW.leaveAt) {
        hideCanvas();
      }
    },
    { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
  ).observe(shelf);
  // Build the scene a little before the section is reached, so its first view is not empty
  new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) enterShelf();
    },
    { rootMargin: "60% 0px" },
  ).observe(shelf);
}

// Decode the screenshots before they are needed (kept in memory), so showing one never stalls a frame.
// The live iframe is never touched here: it is only created by a click on "Try it live".
const demoPrefetch = [];
function prefetchDemos() {
  if (demoPrefetch.length) return;
  panels.forEach((panel) => {
    const img = new Image();
    img.decoding = "async";
    img.src = `/demos/${panel.dataset.slug}.png`;
    img.decode().catch(() => {}); // a project without a screenshot is fine
    demoPrefetch.push(img);
  });
}

export async function enterShelf() {
  if (scene || creating || !canvas || noWebGL) return;
  creating = true;

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
      onLabel: showLabel,
      onClip: (clip) => capsLayer && (capsLayer.style.clipPath = clip),
      // An in-place swap (the turntable stays) starts moving records only once the HTML has really faded out
      waitHidden: () =>
        new Promise((resolve) => {
          const hidden = () => {
            applySwapContent(); // the new record's content goes in now, in one step, out of sight
            resolve();
          };
          if (!player || getComputedStyle(player).opacity < 0.02) return hidden();
          player.addEventListener("transitionend", hidden, { once: true });
        }),
    });

    scene = created;
    creating = false;
    render();
    scene.prewarm(); // records, shaders and textures, before anything is clicked
    prefetchDemos();
    if (wantCanvas) showCanvas();
    applyRoute();
  } catch (err) {
    creating = false;
    console.warn("3D shelf unavailable, showing the list instead.", err);
    fallBackToList();
  }
}

// The list view (or a dev preview) replaces the page: close any open record and hide the canvas
export function leaveShelf() {
  endLive();
  showLabel(-1);
  panels.forEach((panel) => (panel.hidden = true));
  if (demoFrame) demoFrame.hidden = true;
  wantedSlug = null;
  if (scene && uiState !== "stack") {
    routing = true;
    scene.jumpTo(-1);
    routing = false;
  }
  hideCanvas({ instant: true });
  unlockScroll();
  active = -1;
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