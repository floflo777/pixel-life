/**
 * Level-of-detail decisions for the hub crowd (pure). Architecture §1b.1: the nearest Friends are full voxel meshes,
 * the rest impostors; art bible §4.1: full name tags near you, `#id` further out, nothing beyond, at most 12 tags.
 */

/** A Friend the LOD pass considers (world units). */
export interface LodCandidate {
  readonly key: string;
  readonly x: number;
  readonly z: number;
}

/** Near-set size per quality tier (draw-call budget: each near Friend costs ~3 calls, the impostor crowd 3 total). */
export const NEAR_BUDGET = { high: 24, medium: 16, low: 10 } as const;

/** A Friend already near keeps its mesh until another is this much closer (world units), so walkers don't flicker. */
export const NEAR_HYSTERESIS = 1.2;

/**
 * The keys drawn as voxel meshes: the `max` closest to `focus`, with hysteresis for the current near set, plus every
 * key in `always` (you, the selected Friend) regardless of the budget.
 */
export function selectNear(
  candidates: readonly LodCandidate[],
  focus: { readonly x: number; readonly z: number },
  max: number,
  current: ReadonlySet<string> = new Set(),
  always: ReadonlySet<string> = new Set(),
): Set<string> {
  const scored = candidates
    .filter((c) => !always.has(c.key))
    .map((c) => {
      const d = Math.sqrt((c.x - focus.x) ** 2 + (c.z - focus.z) ** 2);
      return { key: c.key, s: current.has(c.key) ? d - NEAR_HYSTERESIS : d };
    })
    .sort((a, b) => a.s - b.s || (a.key < b.key ? -1 : 1));
  const out = new Set<string>();
  for (const c of candidates) if (always.has(c.key)) out.add(c.key);
  const room = Math.max(0, max - out.size);
  for (let i = 0; i < Math.min(room, scored.length); i++) out.add((scored[i] as { key: string }).key);
  return out;
}

/** How much of a name tag to show. */
export type TagLevel = "full" | "id" | "none";

/** Tag LOD distances (world units) and cap (art bible §4.1: 8 u / 16 u, ≤ 12 visible). */
export const TAG_RULES = { fullWithin: 8, idWithin: 16, max: 12 } as const;

/** A tag candidate: its distance to your Friend, and whether it is pinned (you, hovered, tapped). */
export interface TagCandidate {
  readonly key: string;
  readonly distance: number;
  readonly pinned?: boolean;
}

/**
 * Tag level per key. Pinned tags are always full and count toward the cap first; the rest go nearest-first by
 * distance band until `max` tags are shown. Keys not in the result show nothing.
 */
export function selectTags(items: readonly TagCandidate[], rules = TAG_RULES): Map<string, TagLevel> {
  const out = new Map<string, TagLevel>();
  for (const i of items) if (i.pinned) out.set(i.key, "full");
  const rest = items.filter((i) => !i.pinned).sort((a, b) => a.distance - b.distance);
  for (const i of rest) {
    if (out.size >= rules.max) break;
    if (i.distance <= rules.fullWithin) out.set(i.key, "full");
    else if (i.distance <= rules.idWithin) out.set(i.key, "id");
    else break;
  }
  return out;
}
