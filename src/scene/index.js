import * as THREE from "three";
import gsap from "gsap";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createSleeve, SLEEVE_SIZE } from "./sleeve.js";
import { renderCoverTexture, renderEdgeTexture } from "./covers.js";
import {
  createTurntable,
  RECORD_SEATED_POSITION,
  RECORD_HOVER_POSITION,
  TURNTABLE_WIDTH,
  PLATTER_CENTER,
  PLATTER_RADIUS,
} from "./turntable.js";
import { createRecord, createGrooveTexture, RECORD_RADIUS } from "./record.js";
import { createPickProgress, createPickTimeline } from "./pick.js";
import * as K from "./tweaks.js"; // all the tweakable numbers live in tweaks.js

// The Projects section as one three.js scene: the row of sleeves and the turntable, one renderer.
// States: "stack" (browsing: the sleeves lie in a row, see ROW in tweaks.js) -> "transitioning" -> "playing"
// (and from "playing" a swap goes through "transitioning" back to "playing"). In the playing layout the
// played sleeve has left the row, the other sleeves stay on the left, the turntable is in the middle.
//
// `covers` is [{ template, color, title, side, year }] in project order.
// Callbacks: onHover(index | -1), onSelect(index) from the pointer,
// onStateChange(state, index) whenever the state changes, and onPanel(index, amount 0..1)
// while the info panel of that record should fade in / out (it is part of the timeline), and
// onShowcase(progress 0..1) while the showcase layout (see SHOWCASE in tweaks.js) moves, and onLabel(index, place)
// each frame for every sleeve of the row that shows a caption (place = { x: centre, top, size } of the sleeve in viewport px;
// null = no caption for it now), and onClip(css clip-path) when the part of the page the canvas shows changes.
export async function createShelfScene({ canvas, covers, onHover, onSelect, onStateChange, onPanel, onShowcase, onLabel, onClip }) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const devTools = import.meta.env.DEV && new URLSearchParams(location.search).has("dev"); // the scrub sliders: dev server with ?dev=1 only
  const compactQuery = matchMedia(K.COMPACT.query);
  let compact = compactQuery.matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true; // only the turntable and record cast / receive shadows
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false; // two passes per frame, see frame()

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(K.FOV, 1, 0.5, 80);
  // The turntable is drawn by a second camera that is the first one moved sideways to sit in
  // front of it (so it is seen straight on, like the stack) and lens-shifted back, so that
  // both land on screen exactly where one shared camera would put them.
  const tableCamera = new THREE.PerspectiveCamera(K.FOV, 1, 0.5, 80);
  // While the record travels it is drawn by a third camera, blended between the two by the
  // record's arc progress, so its perspective changes continuously instead of switching.
  const recordCamera = new THREE.PerspectiveCamera(K.FOV, 1, 0.5, 80);
  // Sleeves in the row are drawn one at a time, each by this camera moved sideways to sit right in front of
  // that sleeve (and lens-shifted back), so every sleeve is seen straight on, with no perspective skew.
  const rowCamera = new THREE.PerspectiveCamera(K.FOV, 1, 0.5, 80);
  // Reflections and lights
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new RoomEnvironment();
  const envTexture = pmrem.fromScene(roomScene, 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = K.ENV_INTENSITY;

  // Scale of the turntable and record so a record is RECORD_TO_SLEEVE of a sleeve's width
  const RIG_SCALE = (K.RECORD_TO_SLEEVE * SLEEVE_SIZE) / (2 * RECORD_RADIUS);
  const tablePos = new THREE.Vector3(...K.TURNTABLE_POSITION);

  scene.add(new THREE.AmbientLight(0xffffff, K.AMBIENT));
  const key = new THREE.DirectionalLight(0xffffff, K.KEY.intensity);
  key.position.copy(tablePos).add(new THREE.Vector3(...K.KEY.offset));
  key.target.position.copy(tablePos);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xffffff, K.FILL.intensity);
  fill.position.copy(tablePos).add(new THREE.Vector3(...K.FILL.offset));
  fill.target.position.copy(tablePos);
  const rim = new THREE.DirectionalLight(K.RIM.color, K.RIM.intensity);
  rim.position.copy(tablePos).add(new THREE.Vector3(...K.RIM.offset));
  rim.target.position.copy(tablePos);
  scene.add(fill, fill.target, rim, rim.target);

  // The turntable, to the right of the stack (hidden until a record is picked)
  const turntable = createTurntable();
  turntable.position.copy(tablePos);
  turntable.scale.setScalar(RIG_SCALE);
  scene.add(turntable);
  // The turntable fades in while the sleeves move (p.table)
  const tableMaterials = [];
  turntable.traverse((o) => {
    if (o.material) [].concat(o.material).forEach((m) => tableMaterials.push(m));
  });
  let tableAmount = 1;
  function setTableAmount(a) {
    a = Math.round(THREE.MathUtils.clamp(a, 0, 1) * 100) / 100;
    if (a === tableAmount) return;
    tableAmount = a;
    for (const m of tableMaterials) {
      m.transparent = a < 1;
      m.opacity = a;
    }
  }
  const hoverWorld = new THREE.Vector3();
  const seatedWorld = new THREE.Vector3();
  const rigQuat = new THREE.Quaternion();

  // The sleeve stack
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const textureSize = Math.min(K.COVER_TEXTURE_SIZE, renderer.capabilities.maxTextureSize);
  const textures = await Promise.all(
    covers.map((c) => renderCoverTexture(c.template, { size: textureSize, anisotropy })),
  );
  const edgeTextures = await Promise.all(
    covers.map((c) => renderEdgeTexture(c, { size: textureSize, anisotropy })),
  );

  const root = new THREE.Group();
  scene.add(root);

  const n = covers.length;
  const sleeves = covers.map((c, i) => {
    const sleeve = createSleeve({
      index: i,
      texture: textures[i],
      edgeTexture: edgeTextures[i],
      color: c.color,
      brightness: K.COVER_BRIGHTNESS,
      dimStrength: K.DIM_AMOUNT,
    });
    sleeve.state = { lift: 0, glow: 0, dim: 0 };
    sleeve.restY = ((n - 1) / 2 - i) * K.STEP_Y;
    sleeve.baseZ = 0;
    root.add(sleeve.mesh);
    return sleeve;
  });

  // ---- The row ---------------------------------------------------------------
  // rowK[i].v: 0 = sleeve i is in the pile (the collapsed stack's positions), 1 = in its place in the row.
  // enterRow() spreads them out once, staggered; resetRow() puts the pile back (while the canvas is hidden).
  const rowK = covers.map(() => ({ v: 0 }));
  let rowHidden = false; // the list mode has taken the row away (fadeRow): no captions
  const rowOut = { v: 0 }; // browsing: 1 = the row is faded out (sunk by ROW.fadeDrift), 0 = shown
  function enterRow({ instant = false } = {}) {
    gsap.killTweensOf(rowK);
    if (instant || reduceMotion) {
      rowK.forEach((r) => (r.v = 1));
      return;
    }
    rowK.forEach((r, i) => gsap.to(r, { v: 1, duration: ROW.duration, ease: ROW.ease, delay: i * ROW.stagger }));
  }
  function resetRow() {
    gsap.killTweensOf(rowK);
    gsap.killTweensOf(rowOut);
    rowOut.v = 0;
    rowHidden = false;
    rowK.forEach((r) => (r.v = 0));
  }
  // The row fades out sinking (the same fade the other sleeves get when one is picked) or back in; the captions follow it
  function fadeRow(out, duration, onComplete) {
    rowHidden = out;
    gsap.killTweensOf(rowOut);
    if (reduceMotion || !duration) {
      rowOut.v = out ? 1 : 0;
      onComplete?.();
      return;
    }
    gsap.to(rowOut, { v: out ? 1 : 0, duration, ease: out ? "power1.in" : "power2.out", onComplete });
  }

  // ---- State ---------------------------------------------------------------
  let state = "stack";
  let active = -1; // sleeve under the pointer / focused control
  let current = null; // { index, record, p, tl, liftAtPick, glowAtPick, restStart, restQuat, restScale }
  let viewLock = false; // while swapping, the camera stays in the playing layout
  let tableShown = false; // the turntable only exists on screen while a record is picked
  let disposed = false;

  // ---- Collapsed stack (playing state, wide screens) -------------------------
  // collapseK.v: 0 = the remaining sleeves are spread out (the "playing" layout used for swapping),
  // 1 = collapsed like records in a crate. It only shows once the sleeves have closed up
  // (it is multiplied by the sequence's `leave`), so picking, ejecting and swapping are unchanged.
  const CS = K.COLLAPSED_STACK;
  const collapseK = { v: 0 };
  let wantExpanded = false;
  let expandTimer = 0;
  let collapseTimer = 0;
  let collapseTween = null;
  // One invisible box over the whole group (collapsed or open), so moving from sleeve to sleeve
  // never counts as leaving it
  const groupHit = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
  root.add(groupHit);

  function clearCollapseTimers() {
    clearTimeout(expandTimer);
    clearTimeout(collapseTimer);
    expandTimer = collapseTimer = 0;
  }

  // Moves collapseK to 0 (open) or 1 (collapsed); instant = no tween (reduced motion always snaps)
  function tweenCollapse(target, instant = false) {
    collapseTween?.kill();
    collapseTween = null;
    if (instant || reduceMotion) {
      collapseK.v = target;
      return;
    }
    collapseTween = gsap.to(collapseK, {
      v: target,
      duration: target ? CS.collapseDuration : CS.expandDuration,
      ease: target ? CS.collapseEase : CS.expandEase,
      overwrite: true,
    });
  }

  const groupActive = () => state === "playing" && !compact && !exiting;
  const isOpen = () => wantExpanded && collapseK.v < 0.5;

  function expand() {
    if (!groupActive()) return;
    clearCollapseTimers();
    wantExpanded = true;
    tweenCollapse(0);
  }
  function collapse() {
    clearCollapseTimers();
    wantExpanded = false;
    if (state === "playing") tweenCollapse(1);
  }
  // With a small delay, so a quick pass of the pointer does not make it flicker
  function requestExpand() {
    if (!groupActive()) return;
    clearTimeout(collapseTimer);
    collapseTimer = 0;
    if (wantExpanded || expandTimer) return;
    expandTimer = setTimeout(expand, CS.hoverInDelay * 1000);
  }
  function requestCollapse() {
    clearTimeout(expandTimer);
    expandTimer = 0;
    if (!wantExpanded || collapseTimer) return;
    collapseTimer = setTimeout(collapse, CS.hoverOutDelay * 1000);
  }

  // ---- Showcase (playing state, wide screens) ---------------------------------
  // A separate layer on top of the playing state: once the record is spinning, the turntable's own
  // camera tips to look nearly straight down, and the turntable shrinks and slides to the bottom-left
  // corner (a lens shift, see placeTableCamera). The demo frame in the page follows `onShowcase`.
  // Eject and swap play it backwards first, then run their own timelines untouched.
  const SH = K.SHOWCASE;
  const ROW = K.ROW;
  const showcaseK = { v: 0 };
  let showcaseTween = null;
  let exiting = false; // the showcase is playing backwards before an eject / swap starts
  const platterWorld = new THREE.Vector3();
  const tableLook = new THREE.Vector3();

  function setShowcase(v) {
    showcaseK.v = v;
    applyCamera();
    applyReflections();
    onShowcase?.(v);
  }
  // Moves the showcase to 0 or 1; instant (and always with reduced motion) = no tween
  function tweenShowcase(target, { instant = false, onComplete } = {}) {
    showcaseTween?.kill();
    showcaseTween = null;
    if (instant || reduceMotion) {
      setShowcase(target);
      onComplete?.();
      return;
    }
    showcaseTween = gsap.to(showcaseK, {
      v: target,
      duration: target ? SH.duration : SH.exitDuration,
      ease: target ? SH.ease : SH.exitEase,
      overwrite: true,
      onUpdate: () => setShowcase(showcaseK.v),
      onComplete,
    });
  }
  const enterShowcase = () => {
    if (!compact) tweenShowcase(1);
  };
  // If the showcase is on, play it backwards first and only then run `run` (an eject or a swap)
  function afterShowcaseExit(run) {
    if (showcaseK.v <= 0.001) {
      tweenShowcase(0, { instant: true });
      run();
      return;
    }
    exiting = true;
    clearCollapseTimers();
    tweenShowcase(0, {
      onComplete: () => {
        exiting = false;
        run();
      },
    });
  }
  function setState(next, index) {
    state = next;
    onStateChange?.(next, index);
    if (next === "playing") enterShowcase(); // the record has arrived and is spinning
  }

  // Sleeves can be hovered / picked in the stack state, and (on wide screens) while a record
  // is playing, where the other sleeves are the way to swap.
  const canPickSleeves = () => state === "stack" || (state === "playing" && !compact && !exiting);

  function applyHover() {
    sleeves.forEach((s, i) => {
      if (current && i === current.index) return; // the played sleeve is driven by the sequence
      const on = i === active ? 1 : 0;
      gsap.to(s.state, { lift: on, glow: on, duration: 0.4, ease: "power2.out", overwrite: true });
    });
  }

  // ---- Camera and layout ---------------------------------------------------
  // One fixed camera, straight on from the front and pitched down; it never moves sideways.
  // A zoom plus a lens shift (setViewOffset) put the stack's centre line at a screen position:
  // in its column ("stack layout"), or at the left for the "playing layout". The canvas is a
  // full-viewport layer behind the page; the crate is only a placeholder for the stack's column.
  const crate = canvas.parentElement;
  const shelfEl = canvas.closest(".shelf") ?? crate; // the Projects section
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const layoutStack = { x: 0, y: 0, zoom: 1 }; // px: where the row's centre is on screen (the browsing layout), and its zoom
  const layoutPlay = { x: 0, y: 0, zoom: 1 };
  let viewW = 1;
  let viewH = 1;
  let distance = 1;
  let scalePx = 1; // px per world unit in the stack layout

  const camView = { x: 0, y: 0 }; // where the stack camera currently puts the stack's centre line on screen
  const cameraAmount = () => (viewLock ? 1 : current ? current.p.camera : 0);

  function applyCamera(e = cameraAmount()) {
    camera.zoom = THREE.MathUtils.lerp(layoutStack.zoom, layoutPlay.zoom, e);
    const x = THREE.MathUtils.lerp(layoutStack.x, layoutPlay.x, e);
    const y = THREE.MathUtils.lerp(layoutStack.y, layoutPlay.y, e);
    camera.setViewOffset(viewW, viewH, viewW / 2 - x, viewH / 2 - y, viewW, viewH);

    camView.x = x;
    camView.y = y;
    placeTableCamera();
  }

  // The turntable camera. Normally the stack camera moved sideways to sit in front of the turntable
  // (shiftCamera, amount 1). In the showcase it also orbits up to look nearly straight down at the
  // platter, zooms out a little, and the lens shift slides the platter to the corner anchor.
  function placeTableCamera() {
    const s = showcaseK.v;
    if (s <= 0) {
      shiftCamera(tableCamera, 1);
      return;
    }
    const dx = tablePos.x;
    const elevation0 = THREE.MathUtils.degToRad(K.STACK_CAMERA.pitch);
    // The turntable is already tipped towards the camera, so the camera only needs the rest
    const elevation1 = THREE.MathUtils.degToRad(SH.pitch) - turntable.rotation.x;
    const elevation = THREE.MathUtils.lerp(elevation0, elevation1, s);
    tableLook.set(camTarget.x + dx, camTarget.y, camTarget.z).lerp(platterWorld, s);

    tableCamera.fov = camera.fov;
    tableCamera.aspect = camera.aspect;
    tableCamera.zoom = camera.zoom * THREE.MathUtils.lerp(1, SH.scale, s);
    tableCamera.position.set(0, Math.sin(elevation), Math.cos(elevation)).multiplyScalar(distance).add(tableLook);
    tableCamera.lookAt(tableLook);

    // Where the look-at point (the platter at the end) lands on screen
    const radius = PLATTER_RADIUS * RIG_SCALE * scalePx * camera.zoom * SH.scale; // platter radius in px at the end
    const fromX = camView.x + dx * scalePx * camera.zoom;
    const fromY = camView.y;
    const toX = SH.anchor.x * viewW - SH.cropAmount * radius;
    const toY = SH.anchor.y * viewH + SH.cropAmount * radius;
    const x = THREE.MathUtils.lerp(fromX, toX, s);
    const y = THREE.MathUtils.lerp(fromY, toY, s);
    tableCamera.setViewOffset(viewW, viewH, viewW / 2 - x, viewH / 2 - y, viewW, viewH);
  }

  // `cam` becomes the stack camera moved sideways by `amount` (0..1) of the way to the
  // turntable, and lens-shifted back so that things at that distance land on screen
  // exactly where the stack camera puts them. amount 0 = the stack camera, 1 = the turntable camera.
  function shiftCamera(cam, amount) {
    shiftCameraBy(cam, tablePos.x * amount);
  }
  // The same, by distances in world units (dy: up). The view stays pitched the same, and the lens shift puts what
  // is in front of the camera where the stack camera puts it.
  function shiftCameraBy(cam, dx, dy = 0, view = camView, zoom = camera.zoom) {
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.zoom = zoom;
    cam.position.copy(camPos);
    cam.position.x += dx;
    cam.position.y += dy;
    cam.lookAt(camTarget.x + dx, camTarget.y + dy, camTarget.z);
    const k = scalePx * zoom;
    cam.setViewOffset(
      viewW,
      viewH,
      viewW / 2 - (view.x + dx * k),
      viewH / 2 - (view.y - dy * k * Math.cos(THREE.MathUtils.degToRad(K.STACK_CAMERA.pitch))),
      viewW,
      viewH,
    );
  }

  // `out` becomes a camera part of the way (e: 0..1) from `a` to `b`: position, rotation, zoom and lens shift
  const startCamera = new THREE.PerspectiveCamera(K.FOV, 1, 0.5, 80);
  function blendCameras(out, a, b, e) {
    out.fov = THREE.MathUtils.lerp(a.fov, b.fov, e);
    out.aspect = a.aspect;
    out.zoom = THREE.MathUtils.lerp(a.zoom, b.zoom, e);
    out.position.lerpVectors(a.position, b.position, e);
    out.quaternion.slerpQuaternions(a.quaternion, b.quaternion, e);
    out.setViewOffset(
      viewW,
      viewH,
      THREE.MathUtils.lerp(a.view.offsetX, b.view.offsetX, e),
      THREE.MathUtils.lerp(a.view.offsetY, b.view.offsetY, e),
      viewW,
      viewH,
    );
  }

  // Where things sit on screen (the crate scrolls with the page, the canvas does not)
  let lastClip = "";
  let lastRowY = NaN;
  let capSpace = 0; // px under each sleeve of the row for its caption (--cap-gap + --cap-h, style.css)
  function readCapSpace() {
    const cs = getComputedStyle(shelfEl);
    capSpace = (parseFloat(cs.getPropertyValue("--cap-gap")) || 0) + (parseFloat(cs.getPropertyValue("--cap-h")) || 0);
  }
  function placeLayouts() {
    const rect = crate.getBoundingClientRect();
    const crateY = rect.top + rect.height / 2;

    // The canvas only shows within the Projects section, so the sleeves never draw over the hero or About
    const section = shelfEl.getBoundingClientRect();
    const clip = `inset(${Math.max(0, Math.round(section.top))}px 0 ${Math.max(0, Math.round(viewH - section.bottom))}px 0)`;
    if (clip !== lastClip) {
      canvas.style.clipPath = clip;
      onClip?.(clip);
      lastClip = clip;
    }

    // Browsing layout: the row (or the 2 x 2 grid on narrow screens), a fixed gap below the heading and its label
    layoutStack.x = viewW / 2;
    const cols = compact ? Math.min(2, n) : n;
    const rows = Math.ceil(n / cols);
    const step = compact ? ROW.stepCompact : ROW.stepX;
    // Each sleeve has a caption under it (capSpace px): it comes out of the height the row may take, and in the 2 x 2 grid it
    // pushes the second row down by the same amount
    const worldW = (cols - 1) * step + 2;
    const px = Math.min(
      (viewW * ROW.fillWidth) / worldW,
      (viewH * ROW.fillHeight - rows * capSpace) / ((rows - 1) * step + 2),
      ROW.maxSleevePx / 2,
    );
    const stepY = rows > 1 ? step + capSpace / px : step;
    const worldH = (rows - 1) * stepY + 2;
    layoutStack.zoom = px / scalePx;
    const labelEl = shelfEl.querySelector(".shelf-label");
    const headBottom = labelEl ? labelEl.getBoundingClientRect().bottom : section.top + 140;
    const areaTop = headBottom + ROW.gapBelowHeading;
    const areaBottom = Math.min(section.bottom, viewH) - ROW.bottomMargin; // the visible part of the section
    layoutStack.y = Math.max(areaTop + (worldH * px) / 2, (areaTop + areaBottom - capSpace) / 2); // the sleeves and their captions centred in that space, never above it
    // For the soft glow behind the row (CSS: .shelf::before), in the section's own coordinates so it never changes with the
    // scroll (the row itself is centred in the visible part, which does): where the row sits when the section is in place
    const topRel = headBottom - section.top + ROW.gapBelowHeading;
    const bottomRel = Math.min(section.height, viewH) - ROW.bottomMargin;
    const rowY = Math.round(Math.max(topRel + (worldH * px) / 2, (topRel + bottomRel - capSpace) / 2));
    if (rowY !== lastRowY) {
      shelfEl.style.setProperty("--row-y", `${rowY}px`);
      lastRowY = rowY;
    }
    sleeves.forEach((sl, i) => {
      sl.rowX = ((i % cols) - (cols - 1) / 2) * step;
      sl.rowY = ((rows - 1) / 2 - Math.floor(i / cols)) * stepY + ROW.offsetY;
    });

    let scale1;
    if (!compact) {
      const stackX = viewW * K.PLAYING_LAYOUT.stackX;
      const tableX = viewW * K.PLAYING_LAYOUT.tableX;
      scale1 = (tableX - stackX) / tablePos.x;
      layoutPlay.x = stackX;
      layoutPlay.y = crateY + K.PLAYING_LAYOUT.offsetY;
    } else {
      // Turntable fills the top of the column; the stack ends up off screen to the left
      scale1 = (K.COMPACT.tableFit * rect.width) / (TURNTABLE_WIDTH * RIG_SCALE);
      layoutPlay.x = rect.left + rect.width / 2 - tablePos.x * scale1;
      layoutPlay.y = rect.top + rect.width * K.COMPACT.centreY;
    }
    layoutPlay.zoom = scale1 / scalePx;
  }

  function layout() {
    readCapSpace();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const rect = crate.getBoundingClientRect();
    if (!w || !h || !rect.width || !rect.height) return;
    if (w !== viewW || h !== viewH) renderer.setSize(w, h, false);
    viewW = w;
    viewH = h;

    // The field of view makes the crate's height show what a canvas of that size would show
    const baseTan = Math.tan(THREE.MathUtils.degToRad(K.FOV) / 2);
    camera.aspect = w / h;
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((baseTan * h) / rect.height));
    const sc = K.STACK_CAMERA;
    distance =
      Math.max(sc.fitH / (2 * baseTan), sc.fitW / (2 * baseTan * (rect.width / rect.height))) / sc.zoom;
    scalePx = rect.height / (2 * distance * baseTan);

    const pitch = THREE.MathUtils.degToRad(sc.pitch);
    camTarget.set(0, sc.lookAtY, 0);
    camPos.set(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance).add(camTarget);
    camera.position.copy(camPos);
    camera.lookAt(camTarget);

    // Tip the turntable towards the camera so it reads at TABLE_PITCH, then work out where
    // the record sits (hover / seated) in the world
    const seenFrom = Math.atan2(camPos.y - tablePos.y, camPos.z - tablePos.z);
    turntable.rotation.x = THREE.MathUtils.degToRad(K.TABLE_PITCH) - seenFrom;
    turntable.updateMatrixWorld(true);
    turntable.localToWorld(hoverWorld.copy(RECORD_HOVER_POSITION));
    turntable.localToWorld(seatedWorld.copy(RECORD_SEATED_POSITION));
    rigQuat.copy(turntable.quaternion);
    turntable.localToWorld(platterWorld.copy(PLATTER_CENTER));

    placeLayouts();
    applyCamera();
  }
  const resizeObserver = new ResizeObserver(layout); // the viewport (canvas) and the crate column
  resizeObserver.observe(canvas);
  resizeObserver.observe(crate);
  resizeObserver.observe(shelfEl); // the section's height changes when the list opens or closes: the clip and the row follow
  const onScroll = () => {
    placeLayouts();
    applyCamera();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const onCompactChange = () => {
    compact = compactQuery.matches;
    if (compact) tweenShowcase(0, { instant: true }); // narrow screens have no showcase
    layout();
  };
  compactQuery.addEventListener("change", onCompactChange);
  layout();

  // ---- Sleeve placement ----------------------------------------------------
  const pitchRad = THREE.MathUtils.degToRad(K.STACK_CAMERA.pitch);
  const toCamera = new THREE.Vector3();
  const sleeveAt = new THREE.Vector3();

  // How a sleeve lying in the stack at height `y` is tipped and scaled (it faces the camera a little more the higher it is)
  function stackPose(y) {
    toCamera.copy(camPos).sub(sleeveAt.set(0, y, 0));
    return { rotX: pitchRad - Math.atan2(toCamera.y, toCamera.z), scale: toCamera.length() / distance };
  }

  // The same for a sleeve standing in the row at height `y` (facing the camera)
  function standPose(y) {
    toCamera.copy(camPos).sub(sleeveAt.set(0, y, 0));
    return { rotX: Math.PI / 2 - Math.atan2(toCamera.y, toCamera.z), scale: toCamera.length() / distance };
  }

  // Positions every sleeve for the current moment: the stack, with the played sleeve sliding
  // away and fading while the others close up (and the reverse when it comes back).
  function placeSleeves(t, floatAmount) {
    const played = current ? current.index : -1;
    const p = current ? current.p : null;
    const leave = p ? p.leave : 0;
    const direct = p ? p.direct : 0; // 1 = picked from the row (blends to 0 while a swap takes it back to the stack)
    const pin = p ? p.pin : 0;
    const out = p ? p.out * (1 - pin) : 0; // the other sleeves faded out in the row
    const stackIn = p ? Math.max(p.stack, pin) : 1; // the stack on the left faded in
    const leaveEff = leave + (1 - leave) * direct; // how closed up the stack on the left is
    const collapsed = collapseK.v * leaveEff; // 0 = the spread-out layout, 1 = collapsed
    const stackLift = SH.stackOffsetY * showcaseK.v * leaveEff; // the showcase moves the left stack up, clear of the turntable
    const pxToWorld = 1 / (scalePx * camera.zoom);
    root.position.y = Math.sin(t * 0.7) * K.BOB * floatAmount;

    sleeves.forEach((s, i) => {
      let y;
      let x;
      let z = 0;
      let opacity = 1;
      let standing = 0; // 0 = lying like in the stack, 1 = standing in the row
      if (played < 0) {
        // Browsing: from the pile (the collapsed stack's positions) to the sleeve's place in the row, and faded
        // out / sunk while the row comes back after an eject
        const pileY = ((n - 1) / 2 - i) * CS.stepY + CS.offsetY;
        const k = rowK[i].v;
        x = THREE.MathUtils.lerp(0, s.rowX ?? 0, k);
        y = THREE.MathUtils.lerp(pileY, s.rowY ?? 0, k) - ROW.fadeDrift * rowOut.v;
        opacity = 1 - rowOut.v;
        standing = k;
      } else if (i === played) {
        // The chosen sleeve. Picked from the row it stays where it stands (the record comes out of it), lifted a
        // little, and fades out; in a swap it sits in the stack and leaves to the left
        x = THREE.MathUtils.lerp(0, s.rowX ?? 0, direct) - leave * K.LEAVE_OFFSET * (1 - direct);
        y = THREE.MathUtils.lerp(s.restY, (s.rowY ?? 0) + ROW.pickLift * out, direct);
        opacity = 1 - leave;
        standing = direct;
      } else if (direct > 0 && stackIn <= 0) {
        // Picked from the row: the others fade out where they stand, sinking a little (never moving sideways)
        x = s.rowX ?? 0;
        y = (s.rowY ?? 0) - ROW.fadeDrift * out;
        opacity = 1 - out;
        standing = 1;
      } else {
        // The stack on the left: the others close up (and collapse) around the gap. After a pick from the row it
        // fades in, sliding in from the left.
        const rank = i < played ? i : i - 1;
        const closedY = ((n - 2) / 2 - rank) * K.STEP_Y;
        y = THREE.MathUtils.lerp(s.restY, closedY, leaveEff);
        if (collapsed > 0) {
          const collapsedY = ((n - 2) / 2 - rank) * CS.stepY + CS.offsetY;
          y = THREE.MathUtils.lerp(y, collapsedY, collapsed);
          z = collapsed * rank * CS.stepZ;
        }
        y += stackLift;
        x = -(1 - stackIn) * ROW.stackSlidePx * pxToWorld * direct;
        opacity = stackIn;
      }

      // Perspective makes the upper sleeves look flatter, wider and further apart than the
      // lower ones, so tip and scale each one a little to even that out. In the row a sleeve
      // stands up and faces the camera, and is thinner.
      // (a standing sleeve is drawn by a camera moved to its own height, so it is seen from straight ahead whatever its row:
      // it keeps the size and tilt of a sleeve at height 0, which the grid on narrow screens needs for its second row)
      toCamera.copy(camPos).sub(sleeveAt.set(0, y * (1 - standing), 0));
      const phi = Math.atan2(toCamera.y, toCamera.z);
      s.mesh.rotation.x = THREE.MathUtils.lerp(pitchRad - phi, Math.PI / 2 - phi, standing);
      const sc = toCamera.length() / distance;
      s.mesh.scale.set(sc, sc * THREE.MathUtils.lerp(1, ROW.thin, standing), sc);
      // A standing sleeve is drawn by a camera in front of it (it glides to the main camera as a sleeve of the pile
      // stands up when the row spreads out)
      s.standing = standing;
      s.camX = x * standing;
      s.camY = y * standing;

      const bob = Math.sin(t * 0.9 + i * 0.8) * 0.015 * floatAmount;
      const liftY = THREE.MathUtils.lerp(K.LIFT_Y, ROW.hoverLiftY, standing);
      const liftZ = THREE.MathUtils.lerp(K.LIFT_Z, ROW.hoverLiftZ, standing);
      s.mesh.position.set(x, y + bob + s.state.lift * liftY, s.baseZ + z + s.state.lift * liftZ);
      s.setLook(s.state.glow, s.state.dim);
      s.setOpacity(opacity);
    });

    // The hover area: the remaining sleeves (n - 1 of them), spread or collapsed, plus a margin
    const half = (steps, step) => (steps * step) / 2 + 0.12 + CS.hitPadding;
    const open = half(n - 2, K.STEP_Y);
    const shut = half(n - 2, CS.stepY);
    const height = 2 * THREE.MathUtils.lerp(open, shut, collapseK.v);
    groupHit.scale.set(2 + 2 * CS.hitPadding, height, 2 + 2 * CS.hitPadding);
    groupHit.position.set(0, THREE.MathUtils.lerp(0, CS.offsetY, collapseK.v) + stackLift, 0);
  }

  // ---- The sequence --------------------------------------------------------
  const tmpB = new THREE.Vector3();
  const qSleeve = new THREE.Quaternion();
  const ctrl = new THREE.Vector3();
  const restObject = new THREE.Object3D();

  // Lets a record be in a pass without drawing (it still casts its shadow), or draw normally again
  function setRecordDraws(record, draws) {
    record.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) {
        m.colorWrite = draws;
        m.depthWrite = draws;
      }
    });
  }

  // Near the stack the record's reflections are turned down (RECORD_LOOK) and in the showcase, seen
  // from above, a little more (SHOWCASE.reflection), so it stays deep black
  function applyReflections() {
    if (!current) return;
    const look = K.RECORD_LOOK;
    const fade = THREE.MathUtils.smoothstep(current.p.arc, look.fadeStart, look.fadeEnd);
    const base = THREE.MathUtils.lerp(look.nearStack, 1, Math.pow(fade, look.curve));
    current.record.setReflections(base * THREE.MathUtils.lerp(1, SH.reflection, showcaseK.v));
  }

  // Turns the timeline's numbers (current.p) into positions
  function update() {
    if (!current) return;
    const { p, index, record } = current;
    const picked = sleeves[index];

    sleeves.forEach((s, i) => {
      if (i === index) {
        s.state.lift = current.liftAtPick * (1 - p.settle); // the picked sleeve settles back
        s.state.glow = current.glowAtPick * (1 - p.settle);
        s.state.dim = 0;
      } else {
        s.state.dim = p.dim;
      }
    });

    // Record: starts inside its sleeve, slides out of the right edge, arcs to the
    // turntable, then lowers onto the spindle. Everything in world space.
    if (p.arc <= 0) {
      const mesh = picked.mesh;
      mesh.updateWorldMatrix(true, false);
      mesh.getWorldQuaternion(qSleeve);
      mesh.localToWorld(record.position.set(p.slide * K.SLIDE_OUT, 0, 0)); // follows the sleeve's hover / float...
      record.position.x += p.leave * K.LEAVE_OFFSET * (1 - p.direct); // ...but not its slide to the left (a swap): the record stays put
      record.quaternion.copy(qSleeve);
      record.scale.setScalar(RIG_SCALE * mesh.scale.x);
    } else {
      // The sleeve may already be leaving, so arc from where it sat in the stack
      const e = p.arc;
      const start = current.restStart;
      ctrl.copy(start).lerp(hoverWorld, 0.5);
      ctrl.y += K.ARC_HEIGHT;
      const a = (1 - e) * (1 - e);
      const b = 2 * (1 - e) * e;
      const c = e * e;
      record.position
        .set(0, 0, 0)
        .addScaledVector(start, a)
        .addScaledVector(ctrl, b)
        .addScaledVector(hoverWorld, c);
      record.quaternion.slerpQuaternions(current.restQuat, rigQuat, e); // levels out with the platter
      record.scale.setScalar(THREE.MathUtils.lerp(RIG_SCALE * current.restScale, RIG_SCALE, e));
      if (p.lower !== 0) {
        record.position.addScaledVector(tmpB.copy(seatedWorld).sub(hoverWorld), p.lower);
      }
    }

    if (p.direct && !p.pin) {
      showcaseK.v = compact ? 0 : p.camera; // the showcase camera cuts in with the playing layout (nothing else is on screen)
      onShowcase?.(compact ? 0 : p.frame); // the demo frame follows later in the timeline
    }
    applyReflections();

    turntable.setTonearm(p.needle);
    onPanel?.(index, p.panel);
    applyCamera();
    if (devSlider) devSlider.value = current.tl.progress();
  }

  // Throws the record away and puts the sleeves back to normal
  function retire(c) {
    onPanel?.(c.index, 0);
    c.tl.kill();
    scene.remove(c.record); // the record goes back to the pool (see getRecord)
    c.record.visible = false;
    if (current === c) current = null;
    sleeves.forEach((s) => {
      Object.assign(s.state, { lift: 0, glow: 0, dim: 0 });
      s.setOpacity(1);
    });
    if (window.__tl === c.tl) window.__tl = null;
    if (devSlider) devSlider.value = 0;
  }

  function finishEject(c) {
    retire(c);
    clearCollapseTimers();
    wantExpanded = false;
    tweenCollapse(0, true);
    tweenShowcase(0, { instant: true });
    turntable.setTonearm(0);
    tableShown = false;
    viewLock = false;
    rowK.forEach((r) => (r.v = 1)); // back in the row
    gsap.killTweensOf(rowOut);
    rowOut.v = 0;
    applyCamera();
    setState("stack", c.index);
    applyHover();
  }

  // A record that came from a swap ends its reverse in the stack on the left: the stack (and the turntable) fade out,
  // then the row fades back in, rising into place
  function backToRow(c) {
    if (reduceMotion) {
      finishEject(c);
      return;
    }
    c.back = gsap.to(c.p, {
      stack: 0,
      leave: 1,
      table: 0,
      duration: ROW.backFade,
      ease: "power1.in",
      onUpdate: update,
      onComplete: () => {
        c.back = null;
        finishEject(c);
        rowOut.v = 1;
        gsap.to(rowOut, { v: 0, duration: ROW.backFade, ease: "power2.out" });
      },
    });
  }

  // Reduced motion: no travelling, just a short crossfade to the other state
  function crossfade(change) {
    const ms = K.REDUCED_MOTION_FADE * 1000;
    const out = canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms / 2, fill: "forwards" });
    out.finished.then(() => {
      if (disposed) return;
      change();
      canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms / 2 });
      out.cancel();
    });
  }

  // ---- Records: made once, before they are needed ---------------------------------------
  // Drawing the grooves and the label and uploading them to the GPU takes long enough to be felt as a stall, so
  // the records are made (one per project) and their shaders compiled and textures uploaded when the Projects
  // section is about to be reached (prewarm), not when a sleeve is clicked.
  const records = [];
  let grooveTexture = null;
  function getRecord(i) {
    if (!records[i]) {
      const c = covers[i];
      grooveTexture ??= createGrooveTexture();
      const record = createRecord(
        { title: c.title, side: c.side, year: c.year, cover: { color: c.color, ink: c.ink, label: c.label, labelInk: c.labelInk } },
        { grooveTexture },
      );
      record.useEnvironment(envTexture, K.ENV_INTENSITY);
      record.visible = false;
      records[i] = record;
    }
    return records[i];
  }

  let prewarmed = false;
  async function prewarm() {
    if (prewarmed || disposed) return;
    prewarmed = true;
    const idle = () => new Promise((resolve) => (window.requestIdleCallback ? requestIdleCallback(resolve, { timeout: 250 }) : setTimeout(resolve, 40)));
    for (let i = 0; i < n && !disposed; i++) {
      getRecord(i);
      await idle();
    }
    if (disposed || current) return;
    // Compile every shader and upload every texture the pick will need, with one off-screen frame (the canvas
    // is cleared straight afterwards): all records and the turntable visible, half transparent (that variant too)
    records.forEach((r) => {
      scene.add(r);
      r.visible = true;
      r.position.copy(seatedWorld);
    });
    turntable.visible = true;
    setTableAmount(0.5);
    sleeves.forEach((sl) => sl.setOpacity(0.5)); // the faded variant of the sleeve shaders
    renderer.compile(scene, camera);
    scene.traverse((o) => {
      if (!o.material) return;
      for (const m of [].concat(o.material)) for (const v of Object.values(m)) if (v && v.isTexture) renderer.initTexture(v);
    });
    // (its own camera, looking at the turntable, so nothing is culled)
    const warmCamera = new THREE.PerspectiveCamera(40, 2, 0.5, 80);
    warmCamera.position.set(tablePos.x, tablePos.y + 6, tablePos.z + 7);
    warmCamera.lookAt(tablePos);
    root.visible = true;
    renderer.clear();
    renderer.render(scene, warmCamera);
    renderer.clear();
    setTableAmount(1);
    sleeves.forEach((sl) => sl.setOpacity(1));
    turntable.visible = false;
    records.forEach((r) => {
      r.visible = false;
      scene.remove(r);
    });
  }

  // Sets a record up (paused). `speed` scales the timeline; `lock` keeps the camera in the
  // playing layout (used when swapping).
  // Where the record is when it has just slid out of its sleeve: standing in the row (a pick from the row) or sitting
  // in the stack on the left (a swap)
  function restFor(i, fromRow) {
    const s = sleeves[i];
    const pose = fromRow ? standPose(s.rowY ?? 0) : stackPose(s.restY);
    restObject.position.set(fromRow ? (s.rowX ?? 0) : 0, fromRow ? (s.rowY ?? 0) : s.restY, s.baseZ);
    restObject.rotation.set(pose.rotX, 0, 0);
    restObject.scale.setScalar(pose.scale);
    restObject.updateMatrixWorld(true);
    return {
      restStart: restObject.localToWorld(new THREE.Vector3(K.SLIDE_OUT, 0, 0)),
      restQuat: restObject.getWorldQuaternion(new THREE.Quaternion()),
      restScale: pose.scale,
      camStart: fromRow ? { x: s.rowX ?? 0, y: s.rowY ?? 0 } : { x: 0, y: 0 }, // the camera in front of its sleeve
    };
  }

  function beginPick(i, { speed = 1, lock = false, fromRow = true } = {}) {
    const s = sleeves[i];
    const record = getRecord(i);
    if (!record.parent) scene.add(record);
    const rest = restFor(i, fromRow);

    const p = createPickProgress({ direct: fromRow });
    const tl = createPickTimeline(p, update, { direct: fromRow });
    tl.timeScale(speed);
    const picked = {
      index: i,
      record,
      p,
      tl,
      liftAtPick: s.state.lift,
      glowAtPick: s.state.glow,
      ...rest,
      direct: fromRow,
    };
    current = picked;
    viewLock = lock;
    active = -1;
    applyHover();
    clearCollapseTimers();
    wantExpanded = false;
    tweenCollapse(1); // the sleeves collapse as they close up around the gap (see placeSleeves)

    tl.eventCallback("onComplete", () => {
      if (current !== picked || tl.reversed()) return;
      viewLock = false;
      setState("playing", i);
    });
    tableShown = true;
    if (import.meta.env.DEV) window.__tl = tl;
    update();
    return tl;
  }

  // From the stack: pick a record
  function pick(i) {
    if (state !== "stack" || !sleeves[i]) return;
    gsap.killTweensOf(sleeves.map((s) => s.state));
    setState("transitioning", i);
    const tl = beginPick(i);
    if (reduceMotion) crossfade(() => tl.progress(1, false));
    else tl.play(0);
  }

  // Back to the stack. If the showcase is on it plays backwards first, then the timeline runs backwards.
  function eject() {
    if (exiting) {
      showcaseTween?.progress(1, false); // asked again (Esc twice): finish leaving the showcase now
      return;
    }
    if (state !== "playing" || !current) return;
    // A pick from the row is its own timeline backwards, showcase included (the same beats in reverse)
    if (current.direct && !reduceMotion) ejectNow();
    else afterShowcaseExit(ejectNow);
  }

  // The same timeline, backwards
  function ejectNow() {
    if (state !== "playing" || !current) return;
    const c = current;
    clearCollapseTimers();
    wantExpanded = false;
    setState("transitioning", c.index);
    c.tl.timeScale(ROW.ejectSpeed);
    c.tl.eventCallback("onReverseComplete", () => (c.direct ? finishEject(c) : backToRow(c)));
    if (reduceMotion) crossfade(() => c.tl.progress(0, false));
    else c.tl.reverse();
  }

  // While playing: put the current record back (its timeline backwards), then play the new
  // one (a fresh timeline forwards). The camera stays in the playing layout throughout.
  function swap(i) {
    if (state !== "playing" || !current || exiting || i === current.index || !sleeves[i]) return;
    afterShowcaseExit(() => swapNow(i));
  }

  function swapNow(i) {
    if (state !== "playing" || !current || i === current.index || !sleeves[i]) return;
    const old = current;
    viewLock = true;
    active = -1;
    applyHover();
    clearCollapseTimers();
    wantExpanded = false;
    tweenCollapse(0, true); // a swap always starts from the spread-out positions, even if the group was collapsed
    setState("transitioning", i);

    // The old record's timeline plays backwards, then the new one plays forwards. A record that was picked from the
    // row is first turned into the stack kind (its sleeve glides, unseen, into its place in the stack; its record
    // flies back there), and played back only to where it is in its sleeve again.
    const back = old.direct ? ROW.swapAt : 0;
    const next = () => {
      old.swapTween = null;
      old.directTween?.kill();
      old.directTween = null;
      retire(old);
      const tl = beginPick(i, { speed: K.SWAP_SPEED, lock: true, fromRow: false });
      if (reduceMotion) tl.progress(1, false);
      else tl.play(0);
    };
    old.tl.pause();
    const duration = Math.max(0, old.tl.time() - back) / K.SWAP_SPEED;
    if (old.direct) {
      old.p.pin = 1;
      Object.assign(old, restFor(old.index, false));
      if (reduceMotion) old.p.direct = 0;
      else old.directTween = gsap.to(old.p, { direct: 0, duration: Math.min(0.2, duration), ease: "none" });
    }
    if (reduceMotion) {
      crossfade(() => {
        old.tl.time(back, false);
        next();
      });
    } else {
      old.swapTween = old.tl.tweenTo(back, { ease: "none", duration, onComplete: next });
    }
  }

  // Jump to the end of whatever is running (Esc, or a click anywhere)
  function skip() {
    if (!reduceMotion) finishMotion();
  }

  function finishMotion() {
    if (exiting) showcaseTween?.progress(1, false); // finishes the showcase exit, which starts the eject / swap...
    if (state !== "transitioning" || !current) return; // ...and that is finished below
    const c = current;
    if (c.back) {
      c.back.progress(1); // a swapped record on its way back to the row
      return;
    }
    if (c.swapTween) {
      c.directTween?.progress(1);
      c.swapTween.progress(1); // a swap on its way back: finishes it, which starts the new record...
      if (current !== c && state === "transitioning") current.tl.progress(1, false); // ...so finish that too
      return;
    }
    if (c.tl.reversed()) {
      c.tl.progress(0, false); // eject: done. swap: the new record's timeline starts...
      if (state === "transitioning" && current && current !== c) current.tl.progress(1, false); // ...so finish it too
    } else {
      c.tl.progress(1, false);
    }
  }

  // Go straight to a state without animating: the URL changed (#/projects/<slug>, back / forward).
  // index -1 = the stack, otherwise that record is on the turntable.
  function jumpTo(index) {
    finishMotion();
    exiting = false;
    tweenShowcase(0, { instant: true });
    if (state === "playing") {
      if (current.index === index) return;
      const c = current;
      setState("transitioning", c.index);
      c.tl.timeScale(1);
      c.tl.eventCallback("onReverseComplete", () => finishEject(c));
      c.tl.progress(0, false);
    }
    if (index >= 0 && state === "stack" && sleeves[index]) {
      gsap.killTweensOf(sleeves.map((s) => s.state));
      setState("transitioning", index);
      beginPick(index).progress(1, false);
      tweenCollapse(1, true);
      if (!compact) tweenShowcase(1, { instant: true }); // a deep link lands in the showcase end state
    }
  }
  // The captions under the sleeves of the row: for each one, where its sleeve stands (top edge and size, viewport px) while
  // the row is shown. A hover lift is taken out so the caption stays put. Off while a record is picked or the row spreads.
  const capPos = new THREE.Vector3();
  const capEdge = new THREE.Vector3();
  const capRight = new THREE.Vector3();
  const lerp = THREE.MathUtils.lerp;
  const capOn = sleeves.map(() => false);
  function updateLabels() {
    if (!onLabel) return;
    const browsing = state === "stack" && !current && !rowHidden && rowOut.v < 0.5;
    sleeves.forEach((sl, i) => {
      const on = browsing && rowK[i].v > 0.9;
      if (!on) {
        if (capOn[i]) {
          capOn[i] = false;
          onLabel(i, null);
        }
        return;
      }
      // Where the sleeve stands at rest (without its hover lift and the move towards the camera that comes with it), and how wide it looks there
      capPos.copy(sl.mesh.position);
      capPos.y -= sl.state.lift * lerp(K.LIFT_Y, ROW.hoverLiftY, sl.standing);
      capPos.z -= sl.state.lift * lerp(K.LIFT_Z, ROW.hoverLiftZ, sl.standing);
      sl.mesh.parent.localToWorld(capPos);
      shiftCameraBy(rowCamera, sl.camX, sl.camY); // the camera that draws this sleeve
      rowCamera.updateMatrixWorld();
      capRight.setFromMatrixColumn(rowCamera.matrixWorld, 0);
      capEdge.copy(capPos).addScaledVector(capRight, sl.mesh.scale.x); // a facing sleeve is 2 units wide
      capPos.project(rowCamera);
      capEdge.project(rowCamera);
      const half = ((capEdge.x - capPos.x) / 2) * viewW;
      const centreY = ((1 - capPos.y) / 2) * viewH;
      capOn[i] = true;
      onLabel(i, { x: ((capPos.x + 1) / 2) * viewW, top: centreY - half, size: half * 2, lift: ROW.hoverLiftY * half });
    });
  }

  // ---- Render loop (runs only while the canvas is on screen and the tab is visible) ----
  let raf = 0;
  let onScreen = true;
  let lastMs = 0;
  function frame(ms) {
    raf = requestAnimationFrame(frame);
    if (import.meta.env.DEV) window.__frames = (window.__frames ?? 0) + 1; // dev: lets a test see the loop really stops
    const jsStart = import.meta.env.DEV ? performance.now() : 0;
    const dt = Math.min(lastMs ? (ms - lastMs) / 1000 : 0, 0.1);
    lastMs = ms;
    const t = ms / 1000;

    const floatAmount = reduceMotion ? 0 : current ? current.p.bob : 1;
    placeSleeves(t, floatAmount);
    updateLabels();
    if (current && !reduceMotion && current.p.spin > 0.001) current.record.spin(dt, current.p.spin);

    // The scene is drawn in up to three passes, each with the camera that suits what it shows:
    //  1. the stack (stack camera) - plus the record while it is still sliding out of its sleeve,
    //     so that the opaque slab can hide it
    //  2. the turntable (turntable camera) - plus the record once it has arrived (arc = 1)
    //  3. the record while it travels (arc between 0 and 1), with a camera blended between the
    //     two, so its perspective changes smoothly and never switches
    const stackVisible = !(compact && cameraAmount() >= 1); // on narrow screens the stack is off screen while playing
    const arc = current ? current.p.arc : 0;
    const table = current ? Math.max(current.p.table, current.p.pin) : 0;
    setTableAmount(table);
    const tableOn = tableShown && (!current || table > 0.001);
    const recordInSleeve = !!current && arc <= 0;
    const recordInFlight = !!current && arc > 0 && arc < 1;
    const recordOnTable = !!current && arc >= 1;

    renderer.clear();
    turntable.visible = false;
    root.visible = stackVisible;
    const shown = sleeves.map((sl) => sl.mesh.visible);
    const chosenStands = !!current && sleeves[current.index].standing > 0.001;
    // A pick from the row: once its sleeve has faded the record is drawn on its own, by a camera that glides from the
    // one in front of its sleeve (frozen at the row layout) to the turntable's (whatever that is doing)
    const recordSolo = !!current && current.direct && !current.p.pin && arc < 1 && (arc > 0 || !shown[current.index]);
    // Pass 1: the sleeves lying down (the stack), with the main camera - plus the record while it is still sliding
    // out of its sleeve, so that the opaque slab can hide it
    sleeves.forEach((sl, j) => (sl.mesh.visible = shown[j] && !(sl.standing > 0.001)));
    if (current) current.record.visible = recordInSleeve && !chosenStands && !recordSolo;
    renderer.render(scene, camera);
    // Then each standing sleeve (the row), alone, with a camera in front of it (back to front); its record with it
    if (stackVisible) {
      // the chosen sleeve (and its record) last, so the record is never covered by a neighbour
      const order = sleeves.map((_, i) => n - 1 - i).filter((i) => !current || i !== current.index);
      if (current) order.push(current.index);
      for (const i of order) {
        if (!shown[i] || !(sleeves[i].standing > 0.001)) continue;
        sleeves.forEach((sl, j) => (sl.mesh.visible = j === i));
        if (current) current.record.visible = recordInSleeve && i === current.index && !recordSolo;
        shiftCameraBy(rowCamera, sleeves[i].camX, sleeves[i].camY);
        renderer.clearDepth();
        renderer.render(scene, rowCamera);
      }
    }
    sleeves.forEach((sl, j) => (sl.mesh.visible = shown[j]));

    if (tableOn) {
      renderer.clearDepth();
      root.visible = false;
      turntable.visible = true;
      if (current) {
        // While it flies the record is drawn in pass 3. Here it only casts its shadow on the
        // turntable (visible, but writing neither colour nor depth).
        current.record.visible = recordOnTable || recordInFlight;
        setRecordDraws(current.record, !recordInFlight && !recordSolo);
      }
      renderer.render(scene, tableCamera);
    }

    if (recordInFlight || recordSolo) {
      if (current.direct && !current.p.pin) {
        shiftCameraBy(startCamera, current.camStart.x, current.camStart.y, layoutStack, layoutStack.zoom);
        blendCameras(recordCamera, startCamera, tableCamera, arc);
      } else {
        // Its camera glides from the stack camera to the turntable's
        shiftCamera(recordCamera, arc);
      }
      renderer.clearDepth();
      root.visible = false;
      turntable.visible = false;
      current.record.visible = true;
      setRecordDraws(current.record, true);
      renderer.render(scene, recordCamera);
    }

    root.visible = true;
    turntable.visible = false;
    if (current) {
      current.record.visible = true;
      setRecordDraws(current.record, true);
    }
    if (import.meta.env.DEV) (window.__js ??= []).push([ms, +(performance.now() - jsStart).toFixed(1)]); // dev: how long the script spent on this frame
  }  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun && !raf) {
      lastMs = 0; // don't count time spent hidden
      raf = requestAnimationFrame(frame);
    }
    if (!shouldRun && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  const intersection = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  intersection.observe(canvas);
  document.addEventListener("visibilitychange", sync);

  // ---- Pointer picking -------------------------------------------------------
  // Stack state: hovering / clicking a sleeve. Playing state (wide screens): the remaining sleeves
  // are collapsed until the pointer enters their group; then clicking a sleeve swaps. While
  // collapsed, a click on the group only expands it.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  // The scene listens on the whole window (the row and the stack reach beyond the section's centred column), but only
  // reacts within the section's height, and never to anything that starts on a link, button, the panel or the nav
  const ignoresPointer = (e) => {
    if (e.target.closest?.("a, button, input, .info, .demo-frame, .nav")) return true;
    const r = shelfEl.getBoundingClientRect();
    return e.clientY < r.top || e.clientY > r.bottom;
  };
  function aim(e) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      pointer.set(2, 2); // the canvas is hidden: nothing can be hit
      raycaster.setFromCamera(pointer, camera);
      return;
    }
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    camera.updateMatrixWorld(); // the row is drawn by other cameras, so this one is not updated by rendering
    raycaster.setFromCamera(pointer, camera);
  }
  function pickAt(e) {
    aim(e);
    const targets = sleeves
      .filter((s, i) => s.mesh.visible && !(current && i === current.index))
      .map((s) => s.mesh);
    const hit = raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.index : -1;
  }
  function inGroup(e) {
    aim(e);
    return raycaster.intersectObject(groupHit, false).length > 0;
  }
  let hovered = -1;
  let openAtPointerDown = true;
  const setHovered = (i) => {
    if (i === hovered) return;
    hovered = i;
    onHover(i);
  };
  const onMove = (e) => {
    if (e.pointerType === "touch") return;
    if (ignoresPointer(e)) {
      if (hovered !== -1) onLeave();
      return;
    }
    if (state === "stack") {
      const i = pickAt(e);
      document.body.style.cursor = i >= 0 ? "pointer" : "";
      setHovered(i);
    } else if (groupActive()) {
      const inside = inGroup(e);
      if (inside) requestExpand();
      else requestCollapse();
      document.body.style.cursor = inside ? "pointer" : "";
      setHovered(isOpen() ? pickAt(e) : -1); // individual glow only while the group is open
    }
  };
  const onLeave = () => {
    document.body.style.cursor = "";
    setHovered(-1);
    if (groupActive()) requestCollapse();
  };
  const onPointerDown = (e) => {
    if (ignoresPointer(e)) return;
    openAtPointerDown = state !== "playing" || isOpen();
    if (!groupActive()) return;
    const inside = inGroup(e);
    if (e.pointerType === "touch") {
      if (!inside) collapse(); // tapping outside collapses
      else if (!openAtPointerDown) expand(); // the first tap expands (and does not swap)
    }
  };
  const onClick = (e) => {
    if (ignoresPointer(e)) return;
    if (state === "stack") {
      const i = pickAt(e);
      if (i >= 0) onSelect(i);
    } else if (groupActive()) {
      if (!openAtPointerDown) {
        if (inGroup(e)) expand(); // collapsed: a click only expands
        return;
      }
      const i = pickAt(e);
      if (i >= 0) onSelect(i);
    }
  };
  // On touch screens a tap anywhere else on the page also counts as "outside"
  const onDocumentPointerDown = (e) => {
    if (e.pointerType === "touch" && !shelfEl.contains(e.target)) collapse();
  };
  window.addEventListener("pointermove", onMove);
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("click", onClick);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  // ---- Dev helpers (dev builds only): window.__tl, window.__shelf and a scrub slider ----
  let devSlider = null;
  let showSlider = null;
  if (import.meta.env.DEV) {
    window.__shelf = {
      pick, eject, swap, skip, expand, collapse,
      getState: () => state,
      collapseAmount: () => collapseK.v,
      // dev: what is where right now (for measuring the pick / eject motion)
      snap: () => ({
        state,
        tl: current ? +current.tl.time().toFixed(3) : null,
        p: current ? Object.fromEntries(Object.entries(current.p).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, +v.toFixed(3)])) : null,
        table: tableShown,
        s: sleeves.map((sl) => [+sl.mesh.position.x.toFixed(2), +sl.mesh.position.y.toFixed(2), +sl.mesh.rotation.x.toFixed(2), sl.mesh.visible ? 1 : 0]),
      }),
    };
  }
  if (devTools) {
    devSlider = document.createElement("input");
    devSlider.type = "range";
    devSlider.min = "0";
    devSlider.max = "1";
    devSlider.step = "0.001";
    devSlider.value = "0";
    devSlider.title = "Scrub the pick-a-record timeline (pick a record first)";
    devSlider.setAttribute("aria-label", "Scrub the pick-a-record timeline (dev only)");
    Object.assign(devSlider.style, {
      position: "fixed", left: "50%", bottom: "1rem", transform: "translateX(-50%)",
      width: "min(28rem, 80vw)", zIndex: "20",
    });
    devSlider.addEventListener("input", () => {
      if (!current) return;
      current.tl.pause();
      current.tl.progress(Number(devSlider.value), true);
      update();
    });
    document.body.append(devSlider);
    // Showcase: set(progress 0..1) jumps (and stops any tween), enter() / exit() tween it
    window.__showcase = {
      set: (v) => {
        showcaseTween?.kill();
        setShowcase(Math.min(1, Math.max(0, v)));
        showSlider.value = showcaseK.v;
      },
      enter: () => enterShowcase(),
      exit: () => tweenShowcase(0),
      get: () => showcaseK.v,
    };
    showSlider = devSlider.cloneNode();
    showSlider.title = "Scrub the showcase (dev only)";
    showSlider.setAttribute("aria-label", "Scrub the showcase (dev only)");
    showSlider.value = "0";
    Object.assign(showSlider.style, { bottom: "2.6rem" });
    showSlider.addEventListener("input", () => window.__showcase.set(Number(showSlider.value)));
    document.body.append(showSlider);
  }

  sync();

  return {
    setActive(i) {
      if (!canPickSleeves() || (current && i === current.index)) return;
      active = i;
      applyHover();
    },
    pick,
    swap,
    eject,
    skip,
    jumpTo,
    prewarm, // build the records, compile the shaders and upload the textures before a sleeve is clicked
    relayout: layout, // measure the section again (its height changed)
    fadeRow, // fade the row out / in without leaving the stack state (the list mode)
    enterRow, // spread the sleeves out from the pile (the canvas just became visible)
    resetRow, // back to the pile (the canvas just went away)
    expand, // the group of remaining sleeves spreads out (e.g. a sleeve button got keyboard focus)
    requestCollapse, // ...and collapses again after a short delay (focus left the group)
    getState: () => state,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      window.removeEventListener("scroll", onScroll);
      compactQuery.removeEventListener("change", onCompactChange);
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("click", onClick);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      clearCollapseTimers();
      collapseTween?.kill();
      groupHit.geometry.dispose();
      groupHit.material.dispose();
      document.body.style.cursor = "";
      canvas.getAnimations().forEach((a) => a.cancel());
      canvas.style.clipPath = "";
      if (current) {
        current.tl.kill();
        scene.remove(current.record);
        current.record.dispose();
        current = null;
      }
      sleeves.forEach((s) => {
        gsap.killTweensOf(s.state);
        s.dispose();
      });
      records.forEach((r) => r?.dispose());
      grooveTexture?.dispose();
      turntable.dispose();
      roomScene.traverse((o) => {
        o.geometry?.dispose();
        [].concat(o.material ?? []).forEach((m) => m.dispose());
      });
      envTexture.dispose();
      pmrem.dispose();
      key.shadow.map?.dispose();
      renderer.dispose();
      devSlider?.remove();
      showSlider?.remove();
      showcaseTween?.kill();
      if (import.meta.env.DEV) {
        delete window.__tl;
        delete window.__shelf;
        delete window.__showcase;
      }
    },
  };
}
