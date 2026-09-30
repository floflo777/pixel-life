import { toIndices, type Hex64 } from "@pl/shared";

/** Body region names (GDD §9.5): the sprite's bounding box split 3 × 3, row-major, viewer's left first. */
export const BODY_REGIONS = [
  "left ear",
  "crown",
  "right ear",
  "left arm",
  "heart",
  "right arm",
  "left foot",
  "belly",
  "right foot",
] as const;

/**
 * The region most of `pixels` fall in, relative to the bounding box of `front`, or null ("a few pixels") when two
 * regions tie for the most pixels or nothing is given.
 */
export function mendRegion(front: Hex64, pixels: Hex64): string | null {
  const body = toIndices(front);
  const picked = toIndices(pixels);
  if (body.length === 0 || picked.length === 0) return null;
  const xs = body.map((i) => i % 16);
  const ys = body.map((i) => i >> 4);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX + 1;
  const h = Math.max(...ys) - minY + 1;
  const counts = new Array<number>(9).fill(0);
  for (const i of picked) {
    const col = Math.min(2, Math.max(0, Math.floor((((i % 16) - minX) * 3) / w)));
    const row = Math.min(2, Math.max(0, Math.floor((((i >> 4) - minY) * 3) / h)));
    counts[row * 3 + col] = (counts[row * 3 + col] ?? 0) + 1;
  }
  const best = Math.max(...counts);
  const winners = counts.flatMap((c, i) => (c === best ? [i] : []));
  return winners.length === 1 ? (BODY_REGIONS[winners[0] ?? 0] ?? null) : null;
}
