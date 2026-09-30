/** Test fixtures: a small real-looking Friend (Mask-like sprite) and helpers to scar it. Test-only. */
import {
  EMPTY_MASK,
  type FriendView,
  fromIndices,
  fromRows,
  type Hex64,
  regrowthOrder,
  frontMask,
  getBit,
} from "@pl/shared";

const ROWS = [
  "................",
  "....#......#....",
  "....##....##....",
  "....########....",
  "...##.####.##...",
  "...##########...",
  "....###..###....",
  ".....######.....",
  "......####......",
  "....########....",
  "...##########...",
  "...##.####.##...",
  "......#..#......",
  ".....##..##.....",
  "................",
  "................",
];

/** The fixture's front mask. */
export const FIXTURE_FRONT: Hex64 = fromRows(ROWS);

/** A FriendView with `lostCount` scars (first pixels in regrowth order), optional gold and stitches. */
export function fixtureView(
  opts: {
    tokenId?: string;
    lostCount?: number;
    goldHeld?: number;
    streak?: number;
    stitched?: Hex64;
    loaned?: boolean;
    updatedAt?: number;
  } = {},
): FriendView {
  const tokenId = opts.tokenId ?? "344030";
  const frames = Array.from({ length: 64 }, () => FIXTURE_FRONT);
  const appearance = { tokenId, familyId: 1 as const, seed: 0, frames };
  const lostIdx: number[] = [];
  for (const i of regrowthOrder(tokenId)) {
    if (lostIdx.length >= (opts.lostCount ?? 0)) break;
    if (getBit(frontMask(appearance), i)) lostIdx.push(i);
  }
  return {
    appearance,
    loaned: opts.loaned ?? false,
    pub: {
      tokenId,
      scars: {
        lost: lostIdx.length ? fromIndices(lostIdx) : EMPTY_MASK,
        updatedAt: opts.updatedAt ?? 1_000_000,
        version: 1,
      },
      goldHeld: opts.goldHeld ?? 0,
      glowCracks: 0,
      streak: opts.streak ?? 0,
      lastSeen: 1_000_000,
      economy: "sim",
      ...(opts.stitched ? { stitched: opts.stitched } : {}),
    },
  };
}
