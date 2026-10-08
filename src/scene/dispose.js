// Frees the GPU resources of everything under `root` (geometries, materials,
// and the textures those materials use). Safe to call on shared resources.
export function disposeObject(root) {
  const geometries = new Set();
  const materials = new Set();

  root.traverse((obj) => {
    if (obj.geometry) geometries.add(obj.geometry);
    if (obj.material) [].concat(obj.material).forEach((m) => materials.add(m));
  });

  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    for (const value of Object.values(m)) {
      if (value && value.isTexture) value.dispose();
    }
    m.dispose();
  });
}
