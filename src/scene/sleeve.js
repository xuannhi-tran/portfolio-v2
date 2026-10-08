import * as THREE from "three";

export const SLEEVE_SIZE = 2;
export const SLEEVE_THICKNESS = 0.24;

// A thin 3D slab. The top (+Y) face carries the cover texture and the front (+Z)
// edge a small label; both are unlit (MeshBasicMaterial) so they show the exact
// colours of the texture and look the same on every sleeve. The other faces are
// a darker shade of the cover colour and are lit. No shadows are cast or received.
// The record and turntable will get their own files next to this one.
export function createSleeve({ index, texture, edgeTexture, color, brightness = 1 }) {
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

  function setGlow(amount) {
    // Hover / selected: a gentle brightening
    cover.color.setScalar(brightness * (1 + amount * 0.18));
    edge.color.setScalar(brightness * (1 + amount * 0.18));
    for (const m of sides) m.emissiveIntensity = amount * 0.3;
  }
  setGlow(0);

  return {
    mesh,
    // 0..1: how much the sleeve is brightened (hover / selected)
    setGlow,
    dispose() {
      geometry.dispose();
      materials.forEach((m) => m.dispose());
      texture.dispose();
      edgeTexture.dispose();
    },
  };
}
