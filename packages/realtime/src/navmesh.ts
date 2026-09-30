import { COORD_MAX, COORD_MIN, type RoomSlug } from "@pl/shared";
import { closestOnSegment, dist, lerp2, pointInPolygon, type Polygon, segmentCrossing, type Vec2 } from "./geometry.js";

/** A door zone on a room map: walking onto `area` means "go to room `target`" or "open venue `target`". */
export interface HubDoor {
  /** Stable id, unique within the room (e.g. `to-plaza`, `venue-pixel-life`). */
  readonly id: string;
  readonly kind: "room" | "venue";
  /** Room slug (`kind: "room"`) or venue id (`kind: "venue"`). */
  readonly target: string;
  /** Optional venue mode the door opens with (e.g. `daily` at the Daily Gate). */
  readonly mode?: string;
  /** Walkable zone that triggers the door (the lime doormat / bridge end). Must lie inside the walkable area. */
  readonly area: Polygon;
  /** Where a Friend stands when arriving through this door (room doors) or leaving the venue (venue doors). */
  readonly spawn: Vec2;
}

/** A named non-walkable or decorative spot the renderer places a prop on (fountain, Mend Well, Daily Stone…). */
export interface HubLandmark {
  readonly id: string;
  readonly at: Vec2;
}

/**
 * Navmesh data format for one hub room (wire units, integer centimetres, +x east, +z south / toward the camera).
 * Walkable = inside at least one `areas` polygon and inside no `holes` polygon. Areas may overlap (a bridge stub
 * overlapping the plaza disc); holes are props the Friend walks around.
 */
export interface HubNavmesh {
  readonly room: RoomSlug;
  /** Bumped whenever the geometry changes, so clients can cache derived data. */
  readonly version: number;
  readonly areas: readonly Polygon[];
  readonly holes: readonly Polygon[];
  /** Default spawn points (join without a `from` room); the room spreads arrivals over them. */
  readonly spawns: readonly Vec2[];
  readonly doors: readonly HubDoor[];
  readonly landmarks: readonly HubLandmark[];
}

/** What a room needs from its map: point containment and straight-line clipping. */
export interface Walkable {
  /** True when `p` is walkable. */
  contains(p: Vec2): boolean;
  /**
   * Furthest point `q` on a→b such that the whole segment a→q is walkable (a itself is assumed walkable).
   * Returns `b` when the straight walk is clear.
   */
  clip(a: Vec2, b: Vec2): Vec2;
}

/** Distance kept from walls when a walk is clipped, so the stop point is strictly inside. */
const CLIP_BACKOFF = 5;
/** How far path waypoints sit off polygon corners. */
const CORNER_OFFSET = 40;
const EPS_T = 1e-9;

interface Edge {
  readonly a: Vec2;
  readonly b: Vec2;
}

function edgesOf(poly: Polygon): Edge[] {
  return poly.map((a, i) => ({ a, b: poly[(i + 1) % poly.length] as Vec2 }));
}

/** Runtime navmesh: point-in-polygon and exact segment checks over a {@link HubNavmesh}, plus client path finding. */
export class Navmesh implements Walkable {
  readonly #edges: Edge[];
  #graph: { nodes: Vec2[]; adj: number[][] } | null = null;

  /** Wraps `data`; call {@link validateNavmesh} in tests to prove the data is well formed. */
  constructor(readonly data: HubNavmesh) {
    this.#edges = [...data.areas, ...data.holes].flatMap(edgesOf);
  }

  /** Walkable: in some area, in no hole, and inside the int16 wire range. */
  contains(p: Vec2): boolean {
    if (p[0] < COORD_MIN || p[0] > COORD_MAX || p[1] < COORD_MIN || p[1] > COORD_MAX) return false;
    if (!this.data.areas.some((a) => pointInPolygon(p, a))) return false;
    return !this.data.holes.some((h) => pointInPolygon(p, h));
  }

  /**
   * Exact clip: split a→b at every crossing with a polygon edge, classify each interval by its midpoint, and stop
   * at the first non-walkable interval (backed off by a few cm). Cost is O(edges), no sampling.
   */
  clip(a: Vec2, b: Vec2): Vec2 {
    const len = dist(a, b);
    if (len === 0) return a;
    const ts = [0, 1];
    for (const e of this.#edges) {
      const t = segmentCrossing(a, b, e.a, e.b);
      if (t !== null) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i++) {
      const t0 = ts[i] as number;
      const t1 = ts[i + 1] as number;
      if (t1 - t0 < EPS_T) continue;
      if (!this.contains(lerp2(a, b, (t0 + t1) / 2))) {
        return lerp2(a, b, Math.max(0, t0 - CLIP_BACKOFF / len));
      }
    }
    return b;
  }

  /** True when the straight walk a→b stays walkable end to end. */
  segmentWalkable(a: Vec2, b: Vec2): boolean {
    const q = this.clip(a, b);
    return q[0] === b[0] && q[1] === b[1] && this.contains(b);
  }

  /** The door whose zone contains `p`, if any. */
  doorAt(p: Vec2): HubDoor | undefined {
    return this.data.doors.find((d) => pointInPolygon(p, d.area));
  }

  /** The room door leading to `slug` (used to spawn arrivals where they came from). */
  doorTo(slug: string): HubDoor | undefined {
    return this.data.doors.find((d) => d.kind === "room" && d.target === slug);
  }

  /**
   * Nearest walkable point to `p` (for taps on props or off the island): `p` itself when walkable, else a point just
   * inside the closest boundary. Null only for a degenerate mesh.
   */
  nearestWalkable(p: Vec2): Vec2 | null {
    if (this.contains(p)) return p;
    const candidates = this.#edges.map((e) => closestOnSegment(p, e.a, e.b));
    candidates.sort((x, y) => dist(p, x) - dist(p, y));
    for (const c of candidates.slice(0, 6)) {
      for (const step of [10, 25, 60]) {
        for (let k = 0; k < 8; k++) {
          const ang = (k * Math.PI) / 4;
          const q: Vec2 = [Math.round(c[0] + step * Math.cos(ang)), Math.round(c[1] + step * Math.sin(ang))];
          if (this.contains(q)) return q;
        }
      }
    }
    return null;
  }

  /**
   * Shortest walkable polyline a→…→b over a visibility graph of polygon corners (offset into walkable space).
   * Returns `[a, b]` when the straight line is clear, null when `b` is unreachable. Client-side helper: the server
   * only validates straight legs, so a client sends one `move` per waypoint.
   */
  findPath(a: Vec2, b: Vec2): Vec2[] | null {
    if (!this.contains(b)) return null;
    if (this.segmentWalkable(a, b)) return [a, b];
    const g = this.#visibility();
    const n = g.nodes.length;
    const all = [...g.nodes, a, b];
    const src = n;
    const dst = n + 1;
    const neighbours = (i: number): number[] => {
      if (i === src) return [...g.nodes.keys(), dst].filter((j) => this.segmentWalkable(a, all[j] as Vec2));
      const base = g.adj[i] ?? [];
      return this.segmentWalkable(all[i] as Vec2, b) ? [...base, dst] : base;
    };
    // Dijkstra with an A* heuristic; graphs are ~100 nodes, so a linear-scan open set is plenty.
    const gScore = new Map<number, number>([[src, 0]]);
    const prev = new Map<number, number>();
    const open = new Set<number>([src]);
    const closed = new Set<number>();
    while (open.size > 0) {
      let cur = -1;
      let best = Infinity;
      for (const i of open) {
        const f = (gScore.get(i) ?? Infinity) + dist(all[i] as Vec2, b);
        if (f < best) {
          best = f;
          cur = i;
        }
      }
      if (cur === dst) break;
      open.delete(cur);
      closed.add(cur);
      for (const j of neighbours(cur)) {
        if (closed.has(j)) continue;
        const cand = (gScore.get(cur) ?? Infinity) + dist(all[cur] as Vec2, all[j] as Vec2);
        if (cand < (gScore.get(j) ?? Infinity)) {
          gScore.set(j, cand);
          prev.set(j, cur);
          open.add(j);
        }
      }
    }
    if (!prev.has(dst)) return null;
    const path: Vec2[] = [b];
    for (let i = prev.get(dst); i !== undefined; i = prev.get(i)) path.push(all[i] as Vec2);
    return path.reverse();
  }

  #visibility(): { nodes: Vec2[]; adj: number[][] } {
    if (this.#graph) return this.#graph;
    const nodes: Vec2[] = [];
    for (const poly of [...this.data.areas, ...this.data.holes]) {
      poly.forEach((v, i) => {
        const p = poly[(i + poly.length - 1) % poly.length] as Vec2;
        const q = poly[(i + 1) % poly.length] as Vec2;
        const u1 = unit([p[0] - v[0], p[1] - v[1]]);
        const u2 = unit([q[0] - v[0], q[1] - v[1]]);
        let bis = unit([u1[0] + u2[0], u1[1] + u2[1]]);
        if (bis[0] === 0 && bis[1] === 0) bis = [-u1[1], u1[0]];
        for (const s of [1, -1]) {
          const c: Vec2 = [
            Math.round(v[0] + s * CORNER_OFFSET * bis[0]),
            Math.round(v[1] + s * CORNER_OFFSET * bis[1]),
          ];
          if (this.contains(c)) {
            nodes.push(c);
            break;
          }
        }
      });
    }
    const adj: number[][] = nodes.map(() => []);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (this.segmentWalkable(nodes[i] as Vec2, nodes[j] as Vec2)) {
          (adj[i] as number[]).push(j);
          (adj[j] as number[]).push(i);
        }
      }
    }
    this.#graph = { nodes, adj };
    return this.#graph;
  }
}

function unit(v: Vec2): Vec2 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
  return l === 0 ? [0, 0] : [v[0] / l, v[1] / l];
}

/** Structural checks for navmesh data; returns human-readable problems (empty = valid). */
export function validateNavmesh(data: HubNavmesh): string[] {
  const errors: string[] = [];
  const mesh = new Navmesh(data);
  const intCoord = (p: Vec2) =>
    Number.isInteger(p[0]) && Number.isInteger(p[1]) && [p[0], p[1]].every((c) => c >= COORD_MIN && c <= COORD_MAX);
  if (data.areas.length === 0) errors.push("no walkable areas");
  for (const poly of [...data.areas, ...data.holes]) {
    if (poly.length < 3) errors.push("polygon with fewer than 3 vertices");
    if (!poly.every(intCoord)) errors.push("polygon vertex is not an int16 integer");
  }
  if (data.spawns.length === 0) errors.push("no spawn points");
  data.spawns.forEach((s, i) => {
    if (!intCoord(s) || !mesh.contains(s)) errors.push(`spawn ${i} is not walkable`);
  });
  const ids = new Set<string>();
  for (const d of data.doors) {
    if (ids.has(d.id)) errors.push(`duplicate door id ${d.id}`);
    ids.add(d.id);
    if (!intCoord(d.spawn) || !mesh.contains(d.spawn)) errors.push(`door ${d.id} spawn is not walkable`);
    if (mesh.doorAt(d.spawn)) errors.push(`door ${d.id} spawn stands inside a door zone`);
    const c = centroid(d.area);
    if (!mesh.contains(c)) errors.push(`door ${d.id} zone centre is not walkable`);
    if (mesh.findPath(data.spawns[0] ?? d.spawn, c) === null) errors.push(`door ${d.id} is unreachable from spawn`);
  }
  return errors;
}

/** Vertex average of a polygon (inside for the convex door zones we author). */
export function centroid(poly: Polygon): Vec2 {
  const n = poly.length || 1;
  return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
}
