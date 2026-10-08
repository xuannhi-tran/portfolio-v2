import * as THREE from "three";
import gsap from "gsap";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { projects } from "../projects.js";
import { createRecord } from "./record.js";
import {
  createTurntable,
  RECORD_SEATED_POSITION,
  RECORD_HOVER_POSITION,
  TONEARM_REST,
  TONEARM_PLAYING,
} from "./turntable.js";

// Dev-only preview of the turntable and record (route #/dev/turntable).
// Space = spin, N = needle (rest / playing), H = record hover / seated, 1-4 = swap the label.

// ---- Tweak these -----------------------------------------------------------
const FOV = 28; // narrow, like the stack scene
const PITCH = 40; // camera looks down by this many degrees (35-45 reads as an ellipse)
const CAMERA_ZOOM = 1; // >1 closer, <1 further
const LOOK_AT = new THREE.Vector3(0, 0.45, 0.1);
const FIT_W = 3.4; // rough size of the turntable on screen; the camera is placed to fit it
const FIT_H = 2.9;
// Light
const KEY = { intensity: 2, position: [-3, 5, 2.5] }; // from above and the side
const FILL = { intensity: 0.4, position: [3, 3, -1.5] };
// From behind and high: makes the plinth edges read. Keep it well above ~40 degrees, or
// the flat metal parts (button, arm hub) mirror it straight into the camera and blow out.
const RIM = { intensity: 1, position: [2, 6, -3.5], color: 0xcfd9ff };
const AMBIENT = 0.1;
const ENV_INTENSITY = 0.3; // strength of the RoomEnvironment reflections (higher = shinier, greyer)
const SHADOWS = true; // soft shadows (arm on the record, record on the mat)
// Motion
const SPIN_RAMP = 1.2; // seconds to speed up / slow down
const NEEDLE_TIME = 1.6; // seconds for the arm to swing
const HOVER_TIME = 0.9; // seconds for the record to lift / settle
// ----------------------------------------------------------------------------

export function mountDevPreview() {
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Full-screen container below the fixed nav
  const container = document.createElement("div");
  Object.assign(container.style, { position: "fixed", inset: "0", zIndex: "5", background: "#000" });
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  container.append(canvas);

  const help = document.createElement("p");
  help.className = "label";
  help.textContent =
    "Dev · turntable preview — click the button / tonearm (or Tab + Enter) · extras: Space, N, H, 1-4" +
    (reduceMotion ? " · reduced motion: no spinning, instant moves" : "");
  Object.assign(help.style, { position: "absolute", left: "1.5rem", bottom: "1.25rem", margin: "0" });
  container.append(help);
  document.body.append(container);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  renderer.shadowMap.enabled = SHADOWS;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 60);

  // Reflections: a soft room environment
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new RoomEnvironment();
  const envTexture = pmrem.fromScene(roomScene, 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = ENV_INTENSITY;

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT));
  const key = new THREE.DirectionalLight(0xffffff, KEY.intensity);
  key.position.set(...KEY.position);
  key.castShadow = SHADOWS;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, FILL.intensity);
  fill.position.set(...FILL.position);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(RIM.color, RIM.intensity);
  rim.position.set(...RIM.position);
  scene.add(rim);

  // The turntable and a record (a stage-3 controller will do the same thing)
  const turntable = createTurntable();
  scene.add(turntable);

  const record = createRecord(projects[0]);
  record.position.copy(RECORD_SEATED_POSITION);
  scene.add(record);

  // State driven by the controls (mouse, keyboard buttons, shortcut keys)
  const state = { spin: 0, needle: TONEARM_REST, lift: 0, hover: { button: 0, arm: 0 } };
  let spinning = false;
  let needleDown = false;
  let lifted = false;

  // Visually hidden buttons so every control is reachable with Tab + Enter
  const srOnly = {
    position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0",
    overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: "0",
  };
  const makeButton = (text, part) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-pressed", "false");
    Object.assign(b.style, srOnly);
    // No focus ring on a 1px button, so focus lights up the control on the model instead
    b.addEventListener("focus", () => setHover(part, 1));
    b.addEventListener("blur", () => setHover(part, 0));
    container.append(b);
    return b;
  };
  function setHover(part, target) {
    if (state.hover[part] === target && !gsap.isTweening(state.hover)) return;
    gsap.to(state.hover, {
      [part]: target,
      duration: reduceMotion ? 0 : 0.2,
      onUpdate: () => turntable.setHighlight(part, state.hover[part]),
    });
  }
  const spinButton = makeButton("Start or stop the record", "button");
  const armButton = makeButton("Move the tonearm to or from the record", "arm");

  function toggleSpin() {
    if (reduceMotion) return;
    spinning = !spinning;
    spinButton.setAttribute("aria-pressed", String(spinning));
    gsap.to(state, { spin: spinning ? 1 : 0, duration: SPIN_RAMP, ease: "power1.inOut" });
  }
  function toggleNeedle() {
    needleDown = !needleDown;
    armButton.setAttribute("aria-pressed", String(needleDown));
    const target = needleDown ? TONEARM_PLAYING : TONEARM_REST;
    if (reduceMotion) {
      state.needle = target;
      turntable.setTonearm(target);
      return;
    }
    gsap.to(state, {
      needle: target,
      duration: NEEDLE_TIME,
      ease: "power1.inOut",
      onUpdate: () => turntable.setTonearm(state.needle),
    });
  }
  function toggleLift() {
    lifted = !lifted;
    const target = lifted ? 1 : 0;
    if (reduceMotion) {
      state.lift = target;
      return;
    }
    gsap.to(state, { lift: target, duration: HOVER_TIME, ease: "power2.inOut" });
  }

  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement) return; // let a focused button handle its own Space / Enter
    if (e.code === "Space") {
      e.preventDefault();
      toggleSpin();
    } else if (e.key === "n" || e.key === "N") {
      toggleNeedle();
    } else if (e.key === "h" || e.key === "H") {
      toggleLift();
    } else if (/^[1-4]$/.test(e.key)) {
      const project = projects[Number(e.key) - 1];
      if (project) record.setProject(project);
    }
  };
  window.addEventListener("keydown", onKey);

  spinButton.addEventListener("click", toggleSpin);
  armButton.addEventListener("click", toggleNeedle);

  // Mouse: hover highlights and clicks on the turntable's own controls
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hitList = [...turntable.hitTargets.button, ...turntable.hitTargets.arm];
  function partAt(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hitList, false)[0];
    if (!hit) return null;
    return turntable.hitTargets.button.includes(hit.object) ? "button" : "arm";
  }
  let hovered = null;
  const onPointerMove = (e) => {
    if (e.pointerType === "touch") return;
    const part = partAt(e);
    canvas.style.cursor = part ? "pointer" : "";
    if (part !== hovered) {
      if (hovered) setHover(hovered, 0);
      if (part) setHover(part, 1);
      hovered = part;
    }
  };
  const onPointerLeave = () => {
    canvas.style.cursor = "";
    if (hovered) setHover(hovered, 0);
    hovered = null;
  };
  const onCanvasClick = (e) => {
    const part = partAt(e);
    if (part === "button") toggleSpin();
    else if (part === "arm") toggleNeedle();
  };
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("click", onCanvasClick);

  // Camera: from the front, pitched down; distance fits the turntable to the screen
  const pitch = THREE.MathUtils.degToRad(PITCH);
  const viewDir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const dist = Math.max(FIT_H / (2 * tanHalf), FIT_W / (2 * tanHalf * camera.aspect)) / CAMERA_ZOOM;
    camera.position.copy(LOOK_AT).addScaledVector(viewDir, dist);
    camera.lookAt(LOOK_AT);
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  // Render loop (paused while the tab is hidden)
  const clock = new THREE.Clock();
  let raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    record.position.lerpVectors(RECORD_SEATED_POSITION, RECORD_HOVER_POSITION, state.lift);
    if (state.spin > 0.001) record.spin(dt, state.spin);
    renderer.render(scene, camera);
  }
  function sync() {
    if (!document.hidden && !raf) {
      clock.getDelta(); // don't count the time spent hidden
      raf = requestAnimationFrame(frame);
    } else if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }
  document.addEventListener("visibilitychange", sync);
  sync();

  // Leaving the route: stop everything and free the GPU resources
  return function unmount() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    gsap.killTweensOf(state);
    gsap.killTweensOf(state.hover);
    window.removeEventListener("keydown", onKey);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("click", onCanvasClick);
    document.removeEventListener("visibilitychange", sync);
    resizeObserver.disconnect();
    turntable.dispose();
    record.dispose();
    roomScene.traverse((o) => {
      o.geometry?.dispose();
      [].concat(o.material ?? []).forEach((m) => m.dispose());
    });
    envTexture.dispose();
    pmrem.dispose();
    key.shadow.map?.dispose();
    renderer.dispose();
    container.remove();
  };
}
