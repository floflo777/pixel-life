/** Dev fixtures: a real Friend (#344030, Mask) from `friends.json`, scarred like art-bible frame 3, and a test host. */
import raw from "../../../../../docs/design/data/friends.json";
import { applyLoss, familyIdFromName, fromIndices, fromRows, frontMask, type FriendView } from "@pl/shared";
import { createTestVenueHost, type TestVenueHarness } from "@pl/venue-kit";

/** Frame 3's scars on #344030 as (row, col). */
export const FRAME3_SCARS: readonly (readonly [number, number])[] = [
  [1, 10],
  [8, 12],
  [9, 12],
  [11, 12],
  [14, 4],
];

/** A fixture Friend by token id (default #344030) with `scars` lost as of `now`. */
export function devFriend(now: number, tokenId = "344030", scars = FRAME3_SCARS): FriendView {
  const f = raw.find((x) => x.tokenId === tokenId) ?? raw[0];
  if (!f) throw new Error("friends.json is empty");
  const appearance = {
    tokenId: f.tokenId,
    familyId: familyIdFromName(f.family),
    seed: 0,
    frames: f.frames.map(fromRows),
  };
  const lost = fromIndices(scars.map(([r, c]) => r * 16 + c));
  const base = { lost: "0".repeat(64), updatedAt: now, version: 0 };
  const s = applyLoss(base, lost, now, f.tokenId, { front: frontMask(appearance) });
  return {
    appearance,
    pub: { tokenId: f.tokenId, scars: s, goldHeld: 0, glowCracks: 0, streak: 3, lastSeen: now, economy: "sim" },
    loaned: false,
  };
}

/** A venue-kit test host owning `devFriend` (its clock starts at `start`). */
export function devHost(start = 1_800_000_000_000, tokenId?: string): TestVenueHarness {
  return createTestVenueHost({
    startTime: start,
    identity: { mode: "owner", friend: devFriend(start, tokenId), loaned: false },
  });
}
