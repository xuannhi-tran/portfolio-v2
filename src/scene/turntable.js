import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { HOLE_RADIUS, RECORD_THICKNESS } from "./record.js";
import { disposeObject } from "./dispose.js";

// ---- Tweak these -----------------------------------------------------------
// Units are the same as record.js (1 unit = 1 / 0.06 cm). The turntable group's
// origin is the centre of the plinth, on the floor (y = 0).
const FEET = { radius: 0.07, height: 0.05, color: 0x050505 };
const PLINTH = { width: 2.9, height: 0.34, depth: 2.3, radius: 0.06, color: 0x141414, roughness: 0.5 };
const PLATTER = { radius: 0.93, height: 0.12, x: -0.35, z: 0.05, color: 0x1c1c1c, metalness: 0.9, roughness: 0.35 };
const MAT = { radius: 0.9, height: 0.02, color: 0x080808 };
const SPINDLE = { radius: HOLE_RADIUS, height: 0.1, color: 0xc8c8c8 }; // fits the record's hole
const ARM = {
  pivotX: 1.15, // back-right corner
  pivotZ: -0.75,
  needleDrop: 0.1, // arm axis height above the record surface (needle tip hangs this far below)
  lengthA: 1.05, // straight part, pivot to bend
  lengthB: 0.45, // part after the bend
  bend: 18, // degrees the second part turns towards the platter
  tubeRadius: 0.022,
  color: 0xc8c8c8,
  counterweightColor: 0x1a1a1a,
  lift: 0.14, // how far the arm rises while it swings
  playRadius: 0.82, // needle distance from the spindle when playing (0.9 = record edge, ~0.33 = label)
};
const HIGHLIGHT = 0.4; // emissive strength of the hover highlight on the button and arm
// Record positions relative to the turntable group (for stage 3)
const HOVER_HEIGHT = 0.55; // how far above the seated position the record floats
// ----------------------------------------------------------------------------

const plinthTop = FEET.height + PLINTH.height;
const platterTop = plinthTop + PLATTER.height;
const matTop = platterTop + MAT.height;
const armY = matTop + RECORD_THICKNESS + ARM.needleDrop;

export const PLATTER_CENTER = new THREE.Vector3(PLATTER.x, matTop, PLATTER.z);
// Record centre when it sits on the spindle, and when it floats just above it
export const RECORD_SEATED_POSITION = new THREE.Vector3(PLATTER.x, matTop + RECORD_THICKNESS / 2, PLATTER.z);
export const RECORD_HOVER_POSITION = RECORD_SEATED_POSITION.clone().add(new THREE.Vector3(0, HOVER_HEIGHT, 0));

// Where the needle tip is, relative to the arm's pivot, with the arm pointing straight ahead
const bend = THREE.MathUtils.degToRad(ARM.bend);
const dirB = new THREE.Vector3(-Math.sin(bend), 0, Math.cos(bend));
const endOfArm = new THREE.Vector3(0, 0, ARM.lengthA).addScaledVector(dirB, ARM.lengthB);
const stylusLocal = endOfArm.clone().addScaledVector(dirB, 0.07);

function stylusDistanceFromSpindle(angle) {
  const x = ARM.pivotX + stylusLocal.x * Math.cos(angle) + stylusLocal.z * Math.sin(angle);
  const z = ARM.pivotZ - stylusLocal.x * Math.sin(angle) + stylusLocal.z * Math.cos(angle);
  return Math.hypot(x - PLATTER.x, z - PLATTER.z);
}

// Sweeps the arm towards the platter until the needle reaches `radius`
function solveArmAngle(radius) {
  for (let a = 0; a > -Math.PI; a -= 0.002) {
    if (stylusDistanceFromSpindle(a) <= radius) return a;
  }
  return -1;
}

// Tonearm poses, as rotation about its pivot (radians). setTonearm(0..1) blends them.
export const ARM_ANGLE_REST = 0; // parked outside the record, on the arm rest
export const ARM_ANGLE_PLAYING = solveArmAngle(ARM.playRadius); // needle over the grooves
export const TONEARM_REST = 0;
export const TONEARM_PLAYING = 1;

const metal = (color, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 1, roughness });
const matte = (color, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness });

function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Returns a THREE.Group with a plinth, platter, spindle, controls and a tonearm.
// It has no renderer of its own: add it to any scene.
//   turntable.setTonearm(t)  0 = rest, 1 = playing (the arm lifts a little while it swings)
//   turntable.dispose()      free geometries / textures
export function createTurntable() {
  const group = new THREE.Group();

  // Feet
  const footGeometry = new THREE.CylinderGeometry(FEET.radius, FEET.radius * 0.9, FEET.height, 24);
  const footMaterial = matte(FEET.color, 0.6);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const foot = mesh(footGeometry, footMaterial);
      foot.position.set(sx * (PLINTH.width / 2 - 0.2), FEET.height / 2, sz * (PLINTH.depth / 2 - 0.2));
      group.add(foot);
    }
  }

  // Plinth: dark rounded box; the rounded edge catches the light as a subtle lighter rim
  const plinthGeometry = new RoundedBoxGeometry(PLINTH.width, PLINTH.height, PLINTH.depth, 6, PLINTH.radius);
  const plinth = mesh(plinthGeometry, new THREE.MeshStandardMaterial({ color: PLINTH.color, metalness: 0.2, roughness: PLINTH.roughness }));
  plinth.position.y = FEET.height + PLINTH.height / 2;
  group.add(plinth);

  // Platter, rubber mat, spindle
  const platter = mesh(
    new THREE.CylinderGeometry(PLATTER.radius, PLATTER.radius, PLATTER.height, 96),
    new THREE.MeshStandardMaterial({ color: PLATTER.color, metalness: PLATTER.metalness, roughness: PLATTER.roughness }),
  );
  platter.position.set(PLATTER.x, plinthTop + PLATTER.height / 2, PLATTER.z);
  group.add(platter);

  const mat = mesh(new THREE.CylinderGeometry(MAT.radius, MAT.radius, MAT.height, 96), matte(MAT.color, 0.9));
  mat.position.set(PLATTER.x, platterTop + MAT.height / 2, PLATTER.z);
  group.add(mat);

  const spindle = mesh(
    new THREE.CylinderGeometry(SPINDLE.radius, SPINDLE.radius, SPINDLE.height, 24),
    metal(SPINDLE.color, 0.2),
  );
  spindle.position.set(PLATTER.x, matTop + SPINDLE.height / 2, PLATTER.z);
  group.add(spindle);

  // Controls: start/stop button and speed knob, front right
  const buttonMaterial = metal(0xa0a0a0, 0.6); // fairly rough, so lights don't blow it out
  const button = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 32), buttonMaterial);
  button.position.set(1.1, plinthTop + 0.015, 0.88);
  group.add(button);

  // Invisible, roomier shapes used only for mouse picking (see hitTargets below)
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const hit = (geometry) => new THREE.Mesh(geometry, hitMaterial);
  const buttonHit = hit(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 16));
  buttonHit.position.copy(button.position);
  group.add(buttonHit);

  const knob = new THREE.Group();
  knob.position.set(0.78, plinthTop, 0.9);
  const knobBody = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.06, 32), metal(0x222222, 0.4));
  knobBody.position.y = 0.03;
  const knobMark = mesh(new THREE.BoxGeometry(0.01, 0.004, 0.06), matte(0xece6d6, 0.6), { cast: false });
  knobMark.position.set(0, 0.062, -0.03);
  knobMark.rotation.y = 0.5;
  knob.add(knobBody, knobMark);
  group.add(knob);

  // Tonearm tower and arm rest
  const towerHeight = armY - 0.02 - plinthTop;
  const tower = mesh(new THREE.CylinderGeometry(0.1, 0.13, towerHeight, 32), metal(0x2a2a2a, 0.35));
  tower.position.set(ARM.pivotX, plinthTop + towerHeight / 2, ARM.pivotZ);
  group.add(tower);

  const restHeight = armY - ARM.tubeRadius - plinthTop;
  const armRest = mesh(new THREE.CylinderGeometry(0.03, 0.04, restHeight, 16), metal(0x2a2a2a, 0.4));
  armRest.position.set(ARM.pivotX, plinthTop + restHeight / 2, ARM.pivotZ + 0.72);
  group.add(armRest);

  // The arm: a group that turns about its pivot. Built pointing along +Z.
  const arm = new THREE.Group();
  const armMaterial = metal(ARM.color, 0.25);

  const hub = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 32), metal(0x4a4a4a, 0.4));
  arm.add(hub);

  const tubeA = mesh(new THREE.CylinderGeometry(ARM.tubeRadius, ARM.tubeRadius, ARM.lengthA, 16), armMaterial);
  tubeA.rotation.x = Math.PI / 2; // cylinders stand along Y; lay it along Z
  tubeA.position.z = ARM.lengthA / 2;
  arm.add(tubeA);

  const joint = mesh(new THREE.SphereGeometry(ARM.tubeRadius * 1.25, 16, 12), armMaterial);
  joint.position.z = ARM.lengthA;
  arm.add(joint);

  const tubeB = mesh(new THREE.CylinderGeometry(ARM.tubeRadius, ARM.tubeRadius, ARM.lengthB, 16), armMaterial);
  tubeB.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirB);
  tubeB.position.copy(new THREE.Vector3(0, 0, ARM.lengthA).addScaledVector(dirB, ARM.lengthB / 2));
  arm.add(tubeB);

  // Headshell, cartridge and needle
  const headshell = mesh(new THREE.BoxGeometry(0.1, 0.014, 0.2), matte(0x1a1a1a, 0.5));
  headshell.rotation.y = -bend;
  headshell.position.copy(endOfArm).addScaledVector(dirB, 0.06);
  arm.add(headshell);

  const cartridge = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.11), matte(0x303030, 0.5));
  cartridge.rotation.y = -bend;
  cartridge.position.copy(stylusLocal).add(new THREE.Vector3(0, -0.035, 0));
  arm.add(cartridge);

  const needle = mesh(new THREE.ConeGeometry(0.008, 0.04, 12), metal(0xece6d6, 0.3), { cast: false });
  needle.rotation.x = Math.PI; // tip pointing down
  needle.position.copy(stylusLocal).add(new THREE.Vector3(0, -0.08, 0));
  arm.add(needle);

  // Counterweight on a short rear rod
  const rod = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 12), armMaterial);
  rod.rotation.x = Math.PI / 2;
  rod.position.z = -0.15;
  arm.add(rod);

  const counterweight = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.2, 32), matte(ARM.counterweightColor, 0.4));
  counterweight.rotation.x = Math.PI / 2;
  counterweight.position.z = -0.3;
  arm.add(counterweight);

  // Picking shapes along the arm and headshell (thin tubes are hard to click)
  const armHitA = hit(new THREE.BoxGeometry(0.16, 0.16, ARM.lengthA + 0.15));
  armHitA.position.z = ARM.lengthA / 2;
  const armHitB = hit(new THREE.BoxGeometry(0.16, 0.16, ARM.lengthB + 0.3));
  armHitB.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dirB);
  armHitB.position.copy(new THREE.Vector3(0, 0, ARM.lengthA).addScaledVector(dirB, ARM.lengthB / 2 + 0.05));
  arm.add(armHitA, armHitB);

  arm.position.set(ARM.pivotX, armY, ARM.pivotZ);
  group.add(arm);

  // t: 0 = rest, 1 = playing. Ease the swing and lift the arm a little in between.
  group.setTonearm = (t) => {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    const eased = k * k * (3 - 2 * k);
    arm.rotation.y = THREE.MathUtils.lerp(ARM_ANGLE_REST, ARM_ANGLE_PLAYING, eased);
    arm.position.y = armY + Math.sin(Math.PI * k) * ARM.lift;
  };
  group.setTonearm(TONEARM_REST);

  // Mouse picking: raycast against these. Each entry is a list of meshes.
  group.hitTargets = { button: [buttonHit], arm: [armHitA, armHitB] };

  // Hover highlight, amount 0..1, for "button" or "arm"
  const highlighted = {
    button: [buttonMaterial],
    arm: [armMaterial, headshell.material, cartridge.material],
  };
  group.setHighlight = (part, amount) => {
    for (const m of highlighted[part] ?? []) {
      m.emissive.set(0xffffff);
      m.emissiveIntensity = amount * HIGHLIGHT;
    }
  };

  group.dispose = () => disposeObject(group);

  return group;
}
