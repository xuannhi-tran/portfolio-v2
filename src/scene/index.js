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
} from "./turntable.js";
import { createRecord, RECORD_RADIUS } from "./record.js";
import { createPickProgress, createPickTimeline } from "./pick.js";
import * as K from "./tweaks.js"; // all the tweakable numbers live in tweaks.js

// The projects screen as one three.js scene: the sleeve stack and the turntable, one renderer.
// States: "stack" -> "transitioning" -> "playing" (and from "playing" a swap goes through
// "transitioning" back to "playing"). In the playing layout the played sleeve has left the
// stack, the other sleeves stay on the left, the turntable is in the middle.
//
// `covers` is [{ template, color, title, side, year }] in project order.
// Callbacks: onHover(index | -1), onSelect(index) from the pointer,
// onStateChange(state, index) whenever the state changes, and onPanel(index, amount 0..1)
// while the info panel of that record should fade in / out (it is part of the timeline).
export async function createShelfScene({ canvas, covers, onHover, onSelect, onStateChange, onPanel }) {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
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

  // ---- State ---------------------------------------------------------------
  let state = "stack";
  let active = -1; // sleeve under the pointer / focused control
  let current = null; // { index, record, p, tl, liftAtPick, glowAtPick, restStart, restQuat, restScale }
  let viewLock = false; // while swapping, the camera stays in the playing layout
  let tableShown = false; // the turntable only exists on screen while a record is picked
  let disposed = false;

  function setState(next, index) {
    state = next;
    onStateChange?.(next, index);
  }

  // Sleeves can be hovered / picked in the stack state, and (on wide screens) while a record
  // is playing, where the other sleeves are the way to swap.
  const canPickSleeves = () => state === "stack" || (state === "playing" && !compact);

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
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const layoutStack = { x: 0, y: 0 }; // px: where the stack's centre line is on screen
  const layoutPlay = { x: 0, y: 0, zoom: 1 };
  let viewW = 1;
  let viewH = 1;
  let distance = 1;
  let scalePx = 1; // px per world unit in the stack layout

  const camView = { x: 0, y: 0 }; // where the stack camera currently puts the stack's centre line on screen
  const cameraAmount = () => (viewLock ? 1 : current ? current.p.camera : 0);

  function applyCamera(e = cameraAmount()) {
    camera.zoom = THREE.MathUtils.lerp(1, layoutPlay.zoom, e);
    const x = THREE.MathUtils.lerp(layoutStack.x, layoutPlay.x, e);
    const y = THREE.MathUtils.lerp(layoutStack.y, layoutPlay.y, e);
    camera.setViewOffset(viewW, viewH, viewW / 2 - x, viewH / 2 - y, viewW, viewH);

    camView.x = x;
    camView.y = y;
    shiftCamera(tableCamera, 1);
  }

  // `cam` becomes the stack camera moved sideways by `amount` (0..1) of the way to the
  // turntable, and lens-shifted back so that things at that distance land on screen
  // exactly where the stack camera puts them. amount 0 = the stack camera, 1 = the turntable camera.
  function shiftCamera(cam, amount) {
    const dx = tablePos.x * amount;
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.zoom = camera.zoom;
    cam.position.copy(camPos).x += dx;
    cam.lookAt(camTarget.x + dx, camTarget.y, camTarget.z);
    cam.setViewOffset(viewW, viewH, viewW / 2 - (camView.x + dx * scalePx * camera.zoom), viewH / 2 - camView.y, viewW, viewH);
  }

  // Where things sit on screen (the crate scrolls with the page, the canvas does not)
  function placeLayouts() {
    const rect = crate.getBoundingClientRect();
    layoutStack.x = rect.left + rect.width / 2;
    layoutStack.y = rect.top + rect.height / 2;

    let scale1;
    if (!compact) {
      const stackX = viewW * K.PLAYING_LAYOUT.stackX;
      const tableX = viewW * K.PLAYING_LAYOUT.tableX;
      scale1 = (tableX - stackX) / tablePos.x;
      layoutPlay.x = stackX;
      layoutPlay.y = layoutStack.y + K.PLAYING_LAYOUT.offsetY;
    } else {
      // Turntable fills the top of the column; the stack ends up off screen to the left
      scale1 = (K.COMPACT.tableFit * rect.width) / (TURNTABLE_WIDTH * RIG_SCALE);
      layoutPlay.x = rect.left + rect.width / 2 - tablePos.x * scale1;
      layoutPlay.y = rect.top + rect.width * K.COMPACT.centreY;
    }
    layoutPlay.zoom = scale1 / scalePx;
  }

  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const rect = crate.getBoundingClientRect();
    if (!w || !h || !rect.width || !rect.height) return;
    renderer.setSize(w, h, false);
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

    placeLayouts();
    applyCamera();
  }
  const resizeObserver = new ResizeObserver(layout); // the viewport (canvas) and the crate column
  resizeObserver.observe(canvas);
  resizeObserver.observe(crate);
  const onScroll = () => {
    placeLayouts();
    applyCamera();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const onCompactChange = () => {
    compact = compactQuery.matches;
    layout();
  };
  compactQuery.addEventListener("change", onCompactChange);
  layout();

  // ---- Sleeve placement ----------------------------------------------------
  const pitchRad = THREE.MathUtils.degToRad(K.STACK_CAMERA.pitch);
  const toCamera = new THREE.Vector3();
  const sleeveAt = new THREE.Vector3();

  // Positions every sleeve for the current moment: the stack, with the played sleeve sliding
  // away and fading while the others close up (and the reverse when it comes back).
  function placeSleeves(t, floatAmount) {
    const played = current ? current.index : -1;
    const leave = current ? current.p.leave : 0;
    root.position.y = Math.sin(t * 0.7) * K.BOB * floatAmount;

    sleeves.forEach((s, i) => {
      let y = s.restY;
      let x = 0;
      let opacity = 1;
      if (played >= 0) {
        if (i === played) {
          x = -leave * K.LEAVE_OFFSET; // away from the turntable, towards the left stack
          opacity = 1 - leave; // fully transparent when the leave step ends, before the record arcs
        } else {
          const rank = i < played ? i : i - 1;
          const closedY = ((n - 2) / 2 - rank) * K.STEP_Y;
          y = THREE.MathUtils.lerp(s.restY, closedY, leave);
        }
      }

      // Perspective makes the upper sleeves look flatter, wider and further apart than the
      // lower ones, so tip and scale each one a little to even that out.
      toCamera.copy(camPos).sub(sleeveAt.set(0, y, 0));
      s.mesh.rotation.x = pitchRad - Math.atan2(toCamera.y, toCamera.z);
      s.mesh.scale.setScalar(toCamera.length() / distance);

      const bob = Math.sin(t * 0.9 + i * 0.8) * 0.015 * floatAmount;
      s.mesh.position.set(x, y + bob + s.state.lift * K.LIFT_Y, s.baseZ + s.state.lift * K.LIFT_Z);
      s.setLook(s.state.glow, s.state.dim);
      s.setOpacity(opacity);
    });
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
      record.position.x += p.leave * K.LEAVE_OFFSET; // ...but not its slide to the left: the record stays put
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

    // Near the stack the record's reflections are turned down (see RECORD_LOOK in tweaks.js)
    const look = K.RECORD_LOOK;
    const fade = THREE.MathUtils.smoothstep(p.arc, look.fadeStart, look.fadeEnd);
    record.setReflections(THREE.MathUtils.lerp(look.nearStack, 1, Math.pow(fade, look.curve)));

    turntable.setTonearm(p.needle);
    onPanel?.(index, p.panel);
    applyCamera();
    if (devSlider) devSlider.value = current.tl.progress();
  }

  // Throws the record away and puts the sleeves back to normal
  function retire(c) {
    onPanel?.(c.index, 0);
    c.tl.kill();
    scene.remove(c.record);
    c.record.dispose(); // records are created per pick and thrown away afterwards
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
    turntable.setTonearm(0);
    tableShown = false;
    viewLock = false;
    applyCamera();
    setState("stack", c.index);
    applyHover();
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

  // Sets a record up (paused). `speed` scales the timeline; `lock` keeps the camera in the
  // playing layout (used when swapping).
  function beginPick(i, { speed = 1, lock = false } = {}) {
    const s = sleeves[i];
    const c = covers[i];
    const record = createRecord({ title: c.title, side: c.side, year: c.year, cover: { color: c.color } });
    record.useEnvironment(envTexture, K.ENV_INTENSITY);
    scene.add(record);

    // Where the record is when it has just slid out, with the sleeve sitting in the stack
    restObject.position.set(0, s.restY, s.baseZ);
    restObject.rotation.set(s.mesh.rotation.x, 0, 0);
    restObject.scale.copy(s.mesh.scale);
    restObject.updateMatrixWorld(true);
    const restStart = restObject.localToWorld(new THREE.Vector3(K.SLIDE_OUT, 0, 0));
    const restQuat = restObject.getWorldQuaternion(new THREE.Quaternion());

    const p = createPickProgress();
    const tl = createPickTimeline(p, update);
    tl.timeScale(speed);
    const picked = {
      index: i,
      record,
      p,
      tl,
      liftAtPick: s.state.lift,
      glowAtPick: s.state.glow,
      restStart,
      restQuat,
      restScale: s.mesh.scale.x,
    };
    current = picked;
    viewLock = lock;
    active = -1;
    applyHover();

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

  // Back to the stack: the same timeline, backwards
  function eject() {
    if (state !== "playing" || !current) return;
    const c = current;
    setState("transitioning", c.index);
    c.tl.timeScale(1);
    c.tl.eventCallback("onReverseComplete", () => finishEject(c));
    if (reduceMotion) crossfade(() => c.tl.progress(0, false));
    else c.tl.reverse();
  }

  // While playing: put the current record back (its timeline backwards), then play the new
  // one (a fresh timeline forwards). The camera stays in the playing layout throughout.
  function swap(i) {
    if (state !== "playing" || !current || i === current.index || !sleeves[i]) return;
    const old = current;
    viewLock = true;
    active = -1;
    applyHover();
    setState("transitioning", i);

    old.tl.timeScale(K.SWAP_SPEED);
    old.tl.eventCallback("onReverseComplete", () => {
      retire(old);
      const tl = beginPick(i, { speed: K.SWAP_SPEED, lock: true });
      if (reduceMotion) tl.progress(1, false);
      else tl.play(0);
    });
    if (reduceMotion) crossfade(() => old.tl.progress(0, false));
    else old.tl.reverse();
  }

  // Jump to the end of whatever is running (Esc, or a click anywhere)
  function skip() {
    if (!reduceMotion) finishMotion();
  }

  function finishMotion() {
    if (state !== "transitioning" || !current) return;
    const c = current;
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
    }
  }
  // ---- Render loop (runs only while the canvas is on screen and the tab is visible) ----
  let raf = 0;
  let onScreen = true;
  let lastMs = 0;
  function frame(ms) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(lastMs ? (ms - lastMs) / 1000 : 0, 0.1);
    lastMs = ms;
    const t = ms / 1000;

    const floatAmount = reduceMotion ? 0 : current ? current.p.bob : 1;
    placeSleeves(t, floatAmount);
    if (current && !reduceMotion && current.p.spin > 0.001) current.record.spin(dt, current.p.spin);

    // The scene is drawn in up to three passes, each with the camera that suits what it shows:
    //  1. the stack (stack camera) - plus the record while it is still sliding out of its sleeve,
    //     so that the opaque slab can hide it
    //  2. the turntable (turntable camera) - plus the record once it has arrived (arc = 1)
    //  3. the record while it travels (arc between 0 and 1), with a camera blended between the
    //     two, so its perspective changes smoothly and never switches
    const stackVisible = !(compact && cameraAmount() >= 1); // on narrow screens the stack is off screen while playing
    const arc = current ? current.p.arc : 0;
    const recordWithStack = !!current && arc <= 0;
    const recordInFlight = !!current && arc > 0 && arc < 1;
    const recordOnTable = !!current && arc >= 1;

    renderer.clear();
    root.visible = stackVisible;
    turntable.visible = false;
    if (current) current.record.visible = recordWithStack;
    renderer.render(scene, camera);

    if (tableShown) {
      renderer.clearDepth();
      root.visible = false;
      turntable.visible = true;
      if (current) {
        // While it flies the record is drawn in pass 3. Here it only casts its shadow on the
        // turntable (visible, but writing neither colour nor depth).
        current.record.visible = recordOnTable || recordInFlight;
        setRecordDraws(current.record, !recordInFlight);
      }
      renderer.render(scene, tableCamera);
    }

    if (recordInFlight) {
      shiftCamera(recordCamera, arc);
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
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickAt(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const targets = sleeves
      .filter((s, i) => s.mesh.visible && !(current && i === current.index))
      .map((s) => s.mesh);
    const hit = raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.index : -1;
  }
  let hovered = -1;
  const onMove = (e) => {
    if (e.pointerType === "touch" || !canPickSleeves()) return;
    const i = pickAt(e);
    canvas.style.cursor = i >= 0 ? "pointer" : "";
    if (i !== hovered) {
      hovered = i;
      onHover(i);
    }
  };
  const onLeave = () => {
    canvas.style.cursor = "";
    if (hovered !== -1) {
      hovered = -1;
      onHover(-1);
    }
  };
  const onClick = (e) => {
    if (!canPickSleeves()) return;
    const i = pickAt(e);
    if (i >= 0) onSelect(i);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  // ---- Dev helpers (dev builds only): window.__tl, window.__shelf and a scrub slider ----
  let devSlider = null;
  if (import.meta.env.DEV) {
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
    window.__shelf = { pick, eject, swap, skip, getState: () => state };
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
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.style.cursor = "";
      canvas.getAnimations().forEach((a) => a.cancel());
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
      if (import.meta.env.DEV) {
        delete window.__tl;
        delete window.__shelf;
      }
    },
  };
}
