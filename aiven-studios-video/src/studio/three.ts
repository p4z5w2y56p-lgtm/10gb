// Minimal 3D math for slim, real-perspective line work drawn in SVG.
export type V3 = [number, number, number];

export const rotY = (p: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

export const rotX = (p: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
};

export const rotZ = (p: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
};

/** Perspective projection: camera at z = -dist looking down +z. Returns screen point, scale and depth. */
export const project = (p: V3, focal: number, dist: number, cx = 960, cy = 540) => {
  const z = p[2] + dist;
  const s = focal / Math.max(0.05, z);
  return { x: cx + p[0] * s, y: cy - p[1] * s, s, z };
};

/** Evenly spread points on a unit sphere. */
export const fibSphere = (n: number): V3[] => {
  const pts: V3[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = g * i;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return pts;
};

/** k-nearest-neighbour edges (deduplicated). */
export const knnEdges = (pts: V3[], k: number): [number, number][] => {
  const set = new Set<string>();
  const out: [number, number][] = [];
  pts.forEach((p, i) => {
    const d = pts
      .map((q, j) => ({ j, d: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 }))
      .filter((e) => e.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    d.forEach(({ j }) => {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!set.has(key)) {
        set.add(key);
        out.push(i < j ? [i, j] : [j, i]);
      }
    });
  });
  return out;
};

/** Isometric projection (30°) for architectural line drawings. */
export const iso = (x: number, y: number, z: number, scale: number, cx = 960, cy = 540) => ({
  x: cx + (x - z) * Math.cos(Math.PI / 6) * scale,
  y: cy + (x + z) * Math.sin(Math.PI / 6) * scale - y * scale,
});
