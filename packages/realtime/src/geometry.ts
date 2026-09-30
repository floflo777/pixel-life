/** A point on the hub ground plane, `[x, z]` in wire units (centimetres). */
export type Vec2 = readonly [x: number, z: number];
/** A simple polygon (no self-intersections), vertices in order, implicitly closed. */
export type Polygon = readonly Vec2[];

/** Euclidean distance between two points. */
export function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
}

/** Point at parameter `t` on segment a→b (t = 0 → a, t = 1 → b). */
export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Even-odd ray-cast test. Points exactly on an edge may land on either side; callers never rely on edges. */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  const [px, pz] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2;
    const b = poly[j] as Vec2;
    if (a[1] > pz !== b[1] > pz) {
      const xCross = a[0] + ((pz - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (px < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * Parameter `t ∈ [0, 1]` along a→b where it crosses segment c→d, or null when they do not intersect or are parallel.
 * Collinear overlaps return null: callers classify the intervals between crossings by their midpoints, which covers them.
 */
export function segmentCrossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number | null {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const denom = rx * sz - rz * sx;
  if (denom === 0) return null;
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / denom;
  const u = (qx * rz - qz * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/** Closest point to `p` on segment a→b. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return a;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return [a[0] + dx * t, a[1] + dz * t];
}

/** Axis-aligned rectangle as a polygon (clockwise in screen space: +x right, +z down). */
export function rect(x0: number, z0: number, x1: number, z1: number): Polygon {
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

/** Regular n-gon of circumradius `r`, vertices rounded to whole units (data stays integral on the wire). */
export function ngon(cx: number, cz: number, r: number, n: number, phase = 0): Polygon {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (2 * Math.PI * i) / n;
    out.push([Math.round(cx + r * Math.cos(a)), Math.round(cz + r * Math.sin(a))]);
  }
  return out;
}

/** Rectangle with its four corners cut at 45° by `c` units (an "island slab" footprint). */
export function chamferRect(x0: number, z0: number, x1: number, z1: number, c: number): Polygon {
  return [
    [x0 + c, z0],
    [x1 - c, z0],
    [x1, z0 + c],
    [x1, z1 - c],
    [x1 - c, z1],
    [x0 + c, z1],
    [x0, z1 - c],
    [x0, z0 + c],
  ];
}
