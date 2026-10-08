import * as THREE from "three";
import gsap from "gsap";
import { createSleeve } from "./sleeve.js";
import { renderCoverTexture, renderEdgeTexture } from "./covers.js";

// ---- Tweak these -----------------------------------------------------------
// Camera: looks straight at the stack from the front (no yaw), pitched down.
const FOV = 26; // vertical field of view in degrees (narrow = less distortion)
const PITCH = 22; // how far the camera looks down, in degrees (0 = level)
const CAMERA_ZOOM = 1; // >1 pulls the camera closer (bigger stack), <1 further away
const LOOK_AT_Y = 0; // raise/lower where the camera aims (moves the stack on screen)
// Stack (world units; a sleeve is 2 wide, 2 deep, 0.24 thick).
const STEP_Y = 1.3; // vertical distance between sleeves (gap = STEP_Y - thickness)
const CONTENT_W = 2.7; // rough on-screen size of the stack; the camera distance is
const CONTENT_H = 4.8; // chosen so this box just fits the canvas
// Motion
const BOB = 0.05; // idle float amplitude
const LIFT_Y = 0.35; // hover: how far the sleeve rises...
const LIFT_Z = 0.15; // ...and how far it slides towards the camera
// Light and colour
// The cover and its front-edge label are drawn unlit, so they show exactly the
// colours of the SVG covers, evenly, on every sleeve. COVER_BRIGHTNESS scales them
// (1 = identical to the SVG). The lights below only affect the plain side faces.
const COVER_BRIGHTNESS = 1;
const AMBIENT_INTENSITY = 1.2; // soft fill on the side faces
const KEY_INTENSITY = 1.6; // directional light on the side faces
// Texture quality (bigger = crisper text, more GPU memory: 4 covers x size x size x 4 bytes)
const COVER_TEXTURE_SIZE = 2048;
// ----------------------------------------------------------------------------

// Builds the shelf scene on `canvas`. `covers` is [{ template, color }] in
// project order. Calls onHover(index | -1) and onSelect(index) from the pointer.
export async function createShelfScene({ canvas, covers, onHover, onSelect }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  // Colour: sRGB in, sRGB out, no tone mapping, so colours aren't shifted or washed out
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  // No shadows at all (no shadow map): nothing darkens the covers.

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);

  // Lighting (affects only the plain side faces; the covers are unlit, see above)
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const key = new THREE.DirectionalLight(0xffffff, KEY_INTENSITY);
  key.position.set(-2, 8, 3);
  scene.add(key);

  // Sleeves
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const textureSize = Math.min(COVER_TEXTURE_SIZE, renderer.capabilities.maxTextureSize);
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
      brightness: COVER_BRIGHTNESS,
    });
    sleeve.state = { lift: 0, glow: 0 };
    sleeve.baseY = ((n - 1) / 2 - i) * STEP_Y;
    sleeve.restY = sleeve.baseY;
    sleeve.baseZ = 0;
    root.add(sleeve.mesh);
    return sleeve;
  });
  const meshes = sleeves.map((s) => s.mesh);

  // Hover / selection state (set from the pointer or from the text list)
  let active = -1;
  let selected = -1;

  function applyTargets() {
    sleeves.forEach((s, i) => {
      const lift = i === active ? 1 : i === selected ? 0.7 : 0;
      const glow = i === active ? 1 : i === selected ? 0.6 : 0;
      gsap.to(s.state, { lift, glow, duration: 0.4, ease: "power2.out", overwrite: true });
    });
  }

  // Camera: straight on from the front, pitched down by PITCH; the distance is
  // chosen so the stack fits whatever shape the canvas is.
  const pitch = THREE.MathUtils.degToRad(PITCH);
  const viewDir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const dist = Math.max(CONTENT_H / (2 * tanHalf), CONTENT_W / (2 * tanHalf * camera.aspect)) / CAMERA_ZOOM;
    camera.position.copy(viewDir).multiplyScalar(dist);
    camera.position.y += LOOK_AT_Y;
    camera.lookAt(0, LOOK_AT_Y, 0);
    camera.updateProjectionMatrix();

    // Perspective makes the top sleeves look flatter than the bottom ones (they are
    // seen from a shallower angle). Tip each sleeve a few degrees so that all of
    // them are seen at the same angle, PITCH.
    // The same perspective makes the nearer (upper) sleeves look wider and spaced
    // further apart, so scale each one by its distance to even that out.
    const centreDistance = camera.position.length();
    sleeves.forEach((s) => {
      const seenFrom = Math.atan2(camera.position.y - s.baseY, camera.position.z);
      s.mesh.rotation.x = pitch - seenFrom;
      const k = camera.position.distanceTo(new THREE.Vector3(0, s.baseY, 0)) / centreDistance;
      s.mesh.scale.setScalar(k);
      s.restY = s.baseY * k;
    });
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  // Render loop: runs only while the canvas is on screen and the tab is visible
  let raf = 0;
  let onScreen = true;
  function frame(ms) {
    raf = requestAnimationFrame(frame);
    const t = ms / 1000;
    root.position.y = Math.sin(t * 0.7) * BOB;
    sleeves.forEach((s, i) => {
      const bob = Math.sin(t * 0.9 + i * 0.8) * 0.015;
      s.mesh.position.set(0, s.restY + bob + s.state.lift * LIFT_Y, s.baseZ + s.state.lift * LIFT_Z);
      s.setGlow(s.state.glow);
    });
    renderer.render(scene, camera);
  }
  function sync() {
    const shouldRun = onScreen && !document.hidden;
    if (shouldRun && !raf) raf = requestAnimationFrame(frame);
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

  // Pointer picking
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.index : -1;
  }
  let hovered = -1;
  const onMove = (e) => {
    if (e.pointerType === "touch") return;
    const i = pick(e);
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
    const i = pick(e);
    if (i >= 0) onSelect(i);
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  sync();

  return {
    setActive(i) {
      active = i;
      applyTargets();
    },
    setSelected(i) {
      selected = i;
      applyTargets();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.style.cursor = "";
      sleeves.forEach((s) => {
        gsap.killTweensOf(s.state);
        s.dispose();
      });
      renderer.dispose();
    },
  };
}
