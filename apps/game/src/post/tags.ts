import type { Object3D } from "three";
import { PALETTE } from "../stage/palette";

/** Layer the mask/glow pass renders; tagged meshes get it enabled automatically. */
export const MASK_LAYER = 5;

/**
 * Halo tints (streak tiers, art bible §2/§8.11). Index 0 = not a Friend. `goldWhite` animates
 * between gold and white dither at 2 fps in the post pass.
 */
export const HALO_TINTS = {
  halo: 1,
  paper: 2,
  sun: 3,
  coral: 4,
  lilac: 5,
  goldWhite: 6,
} as const;
/** Name of a halo tint. */
export type HaloTint = keyof typeof HALO_TINTS;

/** Glow tints for dot-glow bloom (art bible §8.12). Index 0 = no glow. */
export const GLOW_TINTS = {
  gold: 1,
  lamp: 2,
  signal: 3,
  eye: 4,
  cream: 5,
} as const;
/** Name of a glow tint. */
export type GlowTint = keyof typeof GLOW_TINTS;

/** Colour table the post shader indexes (slot 0 unused). */
export const HALO_COLORS: readonly number[] = [
  0,
  PALETTE.halo,
  PALETTE.paper,
  PALETTE.sun,
  PALETTE.coral,
  PALETTE.lilac,
  PALETTE.gold,
  0,
];
/** Colour table the post shader indexes (slot 0 unused). */
export const GLOW_COLORS: readonly number[] = [0, 0xf2ce68, 0xf7d774, PALETTE.signal, 0x6e6040, 0xfff1c2, 0, 0];

/** Post-pass tag stored on an object; children inherit it unless they opt out. */
export interface PostTag {
  halo?: HaloTint;
  glow?: GlowTint;
  /** Stops inheritance from an ancestor's tag (projected shadows, name-tag quads...). */
  none?: true;
}

const KEY = "plPost";

/** Marks an object (and its descendants) as a Friend for the halo + keyline. Returns an undo. */
export function tagHalo(obj: Object3D, tint: HaloTint = "halo"): () => void {
  return mergeTag(obj, { halo: tint });
}

/** Marks an object (and its descendants) as glowing (dot bloom). Returns an undo. */
export function tagGlow(obj: Object3D, tint: GlowTint): () => void {
  return mergeTag(obj, { glow: tint });
}

/** Stops an object inheriting post tags from its ancestors. */
export function untagged(obj: Object3D): void {
  obj.userData[KEY] = { none: true } satisfies PostTag;
}

function mergeTag(obj: Object3D, add: PostTag): () => void {
  const prev = readTag(obj);
  obj.userData[KEY] = { ...(prev && !prev.none ? prev : {}), ...add } satisfies PostTag;
  return () => {
    if (prev) obj.userData[KEY] = prev;
    else obj.userData[KEY] = undefined;
  };
}

/** The tag set directly on this object (not inherited), if any. */
export function readTag(obj: Object3D): PostTag | undefined {
  const t: unknown = obj.userData[KEY];
  return t && typeof t === "object" ? (t as PostTag) : undefined;
}

/** Resolves a child's effective tag given its parent's, following the inheritance rules. */
export function inheritTag(parent: PostTag | undefined, own: PostTag | undefined): PostTag | undefined {
  if (own?.none) return undefined;
  if (!parent) return own;
  if (!own) return parent;
  return { ...parent, ...own };
}

/** Packs a tag into the mask target's (R, G) bytes: halo index, glow index. */
export function tagCode(t: PostTag | undefined): [number, number] {
  if (!t || t.none) return [0, 0];
  return [t.halo ? HALO_TINTS[t.halo] : 0, t.glow ? GLOW_TINTS[t.glow] : 0];
}
