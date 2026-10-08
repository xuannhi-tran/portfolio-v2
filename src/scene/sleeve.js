import * as THREE from "three";

export const SLEEVE_SIZE = 2;
export const SLEEVE_THICKNESS = 0.24;

// A thin 3D slab. The top (+Y) face carries the cover texture and the front (+Z)
// edge a small label; both are unlit (MeshBasicMaterial) so they show the exact
// colours of the texture and look the same on every sleeve. The other faces are
// a darker shade of the cover colour and are lit. No shadows are cast or received.
// The slab is opaque, so a record placed inside it is hidden until it slides out.
export function createSleeve({ index, texture, edgeTexture, color, brightness = 1, dimStrength = 0.5 }) {
  const dark = new THREE.Color(color).multiplyScalar(0.5);
  const side = () =>
    new THREE.MeshStandardMaterial({ color: dark, emissive: dark, emissiveIntensity: 0, roughness: 0.85 });
  const unlit = (map) => new THREE.MeshBasicMaterial({ map });

  // BoxGeometry face order: +x, -x, +y, -y, +z, -z
  const cover = unlit(texture);
  const edge = unlit(edgeTexture);
  const sides = [side(), side(), side(), side()];
  const materials = [sides[0], sides[1], cover, sides[2], edge, sides[3]];

  const geometry = new THREE.BoxGeometry(SLEEVE_SIZE, SLEEVE_THICKNESS, SLEEVE_SIZE);
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.userData.index = index;

  // glow: 0..1 brightens (hover); dim: 0..1 darkens (other sleeves while one is picked)
  function setLook(glow, dim = 0) {
    const level = brightness * (1 + glow * 0.18) * (1 - dim * dimStrength);
    cover.color.setScalar(level);
    edge.color.setScalar(level);
    for (const m of sides) {
      m.color.copy(dark).multiplyScalar(1 - dim * dimStrength);
      m.emissiveIntensity = glow * 0.3;
    }
  }
  setLook(0, 0);

  // 0..1: fades the whole sleeve out (the played sleeve leaves the stack)
  let opacity = 1;
  function setOpacity(next) {
    if (next === opacity) return;
    opacity = next;
    for (const m of materials) {
      m.transparent = next < 1;
      m.opacity = next;
      m.depthWrite = next >= 1;
    }
    mesh.visible = next > 0.01;
  }

  return {
    mesh,
    setLook,
    setOpacity,
    dispose() {
      geometry.dispose();
      materials.forEach((m) => m.dispose());
      texture.dispose();
      edgeTexture.dispose();
    },
  };
}
