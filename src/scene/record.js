import * as THREE from "three";
import { disposeObject } from "./dispose.js";

// ---- Tweak these -----------------------------------------------------------
// Scale: 1 world unit = 1 / UNITS_PER_CM cm. A 30 cm record is 1.8 units across.
export const UNITS_PER_CM = 0.06;
export const RECORD_RADIUS = 15 * UNITS_PER_CM; // 12 inch vinyl: 30 cm across
export const RECORD_THICKNESS = 0.12 * UNITS_PER_CM; // 1.2 mm
export const LABEL_RADIUS = 5 * UNITS_PER_CM; // 10 cm centre label
export const HOLE_RADIUS = 0.36 * UNITS_PER_CM; // 7.2 mm spindle hole
// Spin: a real 33 1/3 rpm turn is too busy on screen, so it is scaled down.
export const RECORD_RPM = 100 / 3;
export const SPIN_SPEED_SCALE = 0.25; // 1 = real speed
// Look
const VINYL = {
  base: "#030303", // the black of the vinyl
  grooveBrightness: 0.045, // how visible the groove rings are (0 = none)
  roughness: 0.3,
  metalness: 0.05,
  clearcoat: 0.5, // gloss layer: higher = more reflection (and a greyer face)
  clearcoatRoughness: 0.2, // higher = softer reflections
  sheenStrength: 0.3, // brightness of the two painted highlights
  sheenWidth: 0.09, // how wide each highlight is (fraction of a full turn)
};
const LABEL = {
  ink: "#ece6d6", // text colour
  textureSize: 1024,
  grooveTextureSize: 2048,
};
// ----------------------------------------------------------------------------

// Radians per second at SPIN_SPEED_SCALE (multiply by the `speed` you pass to spin()).
export const RECORD_ANGULAR_SPEED = ((RECORD_RPM * 2 * Math.PI) / 60) * SPIN_SPEED_SCALE;

function drawGrooves(canvas) {
  const size = canvas.width;
  const c = size / 2;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = VINYL.base;
  ctx.fillRect(0, 0, size, size);

  // Concentric grooves from the run-in near the label out to the rim
  const inner = (LABEL_RADIUS / RECORD_RADIUS) * c * 1.08;
  const outer = c * 0.975;
  ctx.lineWidth = 1;
  for (let r = inner; r < outer; r += 2.5) {
    ctx.strokeStyle = `rgba(255,255,255,${VINYL.grooveBrightness * (0.5 + Math.random() * 0.5)})`;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Smooth gaps between tracks
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.lineWidth = 9;
  for (const ratio of [0.52, 0.68, 0.82]) {
    ctx.beginPath();
    ctx.arc(c, c, ratio * c, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Rim
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.992, 0, Math.PI * 2);
  ctx.stroke();

  // Soft conic sheen: two opposite highlights
  if (ctx.createConicGradient) {
    const a = VINYL.sheenStrength;
    const w = VINYL.sheenWidth;
    const g = ctx.createConicGradient(Math.PI * 0.25, c, c);
    // Two opposite highlights with a smooth (bell-shaped) falloff
    const bell = (centre) => {
      for (const [d, k] of [[-1, 0], [-0.7, 0.12], [-0.4, 0.45], [0, 1], [0.4, 0.45], [0.7, 0.12], [1, 0]]) {
        g.addColorStop(centre + d * w, `rgba(255,255,255,${a * k})`);
      }
    };
    g.addColorStop(0, "rgba(255,255,255,0)");
    bell(0.17);
    bell(0.67);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, outer, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
}

// Greedy word wrap for the title on the label
function wrap(text, max = 12) {
  const lines = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= max) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  return lines;
}

// `project` is one of the entries in src/projects.js
function drawLabel(canvas, project) {
  const size = canvas.width;
  const c = size / 2;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = project.cover.label || project.cover.color; // some records have a lighter label than their sleeve
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  const ink = project.cover.labelInk || project.cover.ink || LABEL.ink;

  // Fine ring near the edge
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.004;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.92, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Small mono line above the title
  ctx.globalAlpha = 0.75;
  ctx.font = `${size * 0.038}px "IBM Plex Mono", monospace`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * 0.004}px`;
  ctx.fillText(`SIDE ${project.side} · ${project.year}`, c, c - size * 0.2);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;

  // Title below the hole
  const lines = wrap(project.title);
  const fontSize = size * 0.085;
  ctx.font = `${fontSize}px "EB Garamond", Georgia, serif`;
  lines.forEach((line, i) => {
    ctx.fillText(line, c, c + size * 0.17 + i * fontSize * 1.05);
  });

  // The spindle hole
  ctx.fillStyle = "#050505";
  ctx.beginPath();
  ctx.arc(c, c, (HOLE_RADIUS / LABEL_RADIUS) * c, 0, Math.PI * 2);
  ctx.fill();
}

// The grooves are the same on every record, so a scene can draw them once and share the texture
export function createGrooveTexture() {
  const grooveCanvas = document.createElement("canvas");
  grooveCanvas.width = grooveCanvas.height = LABEL.grooveTextureSize;
  drawGrooves(grooveCanvas);
  const grooveTexture = new THREE.CanvasTexture(grooveCanvas);
  grooveTexture.colorSpace = THREE.SRGBColorSpace;
  grooveTexture.anisotropy = 16; // clamped to what the GPU supports
  return grooveTexture;
}

// Returns a THREE.Group holding a vinyl record lying flat, centred on its own
// origin. It has no renderer of its own: add it to any scene. `grooveTexture` is optional (see above).
//   record.setProject(project)  swap the label
//   record.spin(dt, speed = 1)  advance the spin (dt in seconds; 1 = the calm base speed)
//   record.dispose()            free geometries / textures
export function createRecord(project, { grooveTexture = createGrooveTexture() } = {}) {
  const group = new THREE.Group();
  const spinner = new THREE.Group(); // everything that turns
  group.add(spinner);

  // Disc with grooves
  const vinylTop = new THREE.MeshPhysicalMaterial({
    map: grooveTexture,
    roughness: VINYL.roughness,
    metalness: VINYL.metalness,
    clearcoat: VINYL.clearcoat,
    clearcoatRoughness: VINYL.clearcoatRoughness,
  });
  const vinylEdge = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4 });
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(RECORD_RADIUS, RECORD_RADIUS, RECORD_THICKNESS, 128),
    [vinylEdge, vinylTop, vinylTop],
  );
  disc.castShadow = true;
  disc.receiveShadow = true;
  spinner.add(disc);

  // Centre label
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = labelCanvas.height = LABEL.textureSize;
  drawLabel(labelCanvas, project);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  labelTexture.anisotropy = 8;
  const label = new THREE.Mesh(
    new THREE.CircleGeometry(LABEL_RADIUS, 64),
    new THREE.MeshStandardMaterial({ map: labelTexture, roughness: 0.65 }),
  );
  label.rotation.x = -Math.PI / 2; // lie flat, title reading upright from the front
  label.position.y = RECORD_THICKNESS / 2 + 0.0006; // just above the vinyl (no z-fighting)
  label.receiveShadow = true;
  spinner.add(label);

  // The title uses web fonts; redraw once they have loaded.
  let disposed = false;
  let current = project;
  Promise.all([
    document.fonts.load('48px "EB Garamond"'),
    document.fonts.load('20px "IBM Plex Mono"'),
  ])
    .then(() => {
      if (disposed) return;
      drawLabel(labelCanvas, current);
      labelTexture.needsUpdate = true;
    })
    .catch(() => {});

  // Reflections can be turned down (0..1) without touching the painted groove sheen. The
  // scene hands over its environment map so that the intensity is controllable per record.
  let envIntensity = 1;
  group.useEnvironment = (envMap, intensity = 1) => {
    envIntensity = intensity;
    for (const m of [vinylTop, vinylEdge]) {
      m.envMap = envMap;
      m.needsUpdate = true;
    }
    group.setReflections(1);
  };
  group.setReflections = (amount) => {
    vinylTop.envMapIntensity = envIntensity * amount;
    vinylEdge.envMapIntensity = envIntensity * amount;
    vinylTop.clearcoat = VINYL.clearcoat * amount;
    vinylTop.specularIntensity = amount;
  };

  group.setProject = (next) => {
    current = next;
    drawLabel(labelCanvas, next);
    labelTexture.needsUpdate = true;
  };

  // Vinyl turns clockwise seen from above, which is negative rotation about +Y.
  group.angle = () => spinner.rotation.y; // (dev: lets a test see the record turn)
  group.spin = (dt, speed = 1) => {
    spinner.rotation.y -= RECORD_ANGULAR_SPEED * speed * dt;
  };

  group.dispose = () => {
    disposed = true;
    disposeObject(group);
  };

  return group;
}
