/** Real Friend sprites (docs/design/data/friends.json, decoded SDK rows) as typed test fixtures. */
import raw from "../../../../docs/design/data/friends.json";
import { fromRows } from "../bitmap.js";
import type { FriendAppearance } from "../friend.js";
import { familyIdFromName } from "../ids.js";

/** One fixture Friend exactly as stored in friends.json. */
export interface FriendFixture {
  tokenId: string;
  family: string;
  frames: string[][];
}

/** All 13 fixture Friends. */
export const FRIEND_FIXTURES: readonly FriendFixture[] = raw;

/** Fixture as a `FriendAppearance` (the fixtures carry no seed; 0 is used). */
export function fixtureAppearance(f: FriendFixture): FriendAppearance {
  return { tokenId: f.tokenId, familyId: familyIdFromName(f.family), seed: 0, frames: f.frames.map(fromRows) };
}
