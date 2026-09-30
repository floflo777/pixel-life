/** The 13 real Friends of `docs/design/data/friends.json` as `FriendAppearance`s (tests and the dev gallery). */
import raw from "../../../../../docs/design/data/friends.json";
import { familyIdFromName, fromRows, type FriendAppearance } from "@pl/shared";

/** All fixture Friends, in file order (seed 0: the fixtures carry no seed). */
export const FIXTURE_FRIENDS: readonly FriendAppearance[] = raw.map((f) => ({
  tokenId: f.tokenId,
  familyId: familyIdFromName(f.family),
  seed: 0,
  frames: f.frames.map(fromRows),
}));

/** Family name of a fixture Friend by token id. */
export const FIXTURE_FAMILY: ReadonlyMap<string, string> = new Map(raw.map((f) => [f.tokenId, f.family]));
