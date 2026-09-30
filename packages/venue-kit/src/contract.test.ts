import { SEED_PACK } from "@pl/shared";
import { describe, expect, it } from "vitest";
import {
  canEnter,
  isNativeVenue,
  isSdkFrameVenue,
  manifestProblems,
  type NativeVenue,
  type SdkFrameVenue,
  type Venue,
  type VenueManifest,
} from "./contract.js";
import { testFriendView } from "./test-host.js";

const pixelLife: VenueManifest = {
  id: "pixel-life",
  name: "Pixel Life",
  version: "1.0.0",
  kind: "native",
  room: "pixel-arena",
  requires: { ownedFriend: false },
  economy: { sinks: ["regrow", "mend"] },
  results: { leaderboard: "score-desc", affectsScars: true },
  thumbnail: "/venues/pixel-life/thumb.png",
};

const seedPack: SdkFrameVenue = {
  manifest: {
    id: "seed-pack",
    name: "Seed Pack Booth",
    version: "1.0.0",
    kind: "sdk-frame",
    room: "seed-booth",
    requires: { ownedFriend: true },
    economy: { sinks: ["seedpack"], chanceGame: SEED_PACK },
    results: { affectsScars: false },
    thumbnail: "/venues/seed-pack/thumb.png",
  },
  frameUrl: "/venues/seed-pack/game.html",
  definition: SEED_PACK,
};

const native: NativeVenue = {
  manifest: pixelLife,
  async mount() {
    return { pause() {}, resize() {}, async unmount() {} };
  },
};

describe("venue contract", () => {
  it("narrows venues by kind", () => {
    const venues: Venue[] = [native, seedPack];
    expect(venues.filter(isNativeVenue)).toEqual([native]);
    expect(venues.filter(isSdkFrameVenue)).toEqual([seedPack]);
  });

  it("blocks guests and loaners from owner-only venues", () => {
    const owner = { mode: "owner" as const, friend: testFriendView(), loaned: false };
    const guest = { mode: "guest" as const, friend: testFriendView({ loaned: true }), loaned: true };
    expect(canEnter(seedPack.manifest, owner)).toBe(true);
    expect(canEnter(seedPack.manifest, guest)).toBe(false);
    expect(canEnter(seedPack.manifest, { ...owner, loaned: true })).toBe(false);
    expect(canEnter(pixelLife, guest)).toBe(true);
  });

  it("validates manifests", () => {
    expect(manifestProblems(pixelLife)).toEqual([]);
    expect(manifestProblems(seedPack.manifest)).toEqual([]);
    expect(
      manifestProblems({
        ...seedPack.manifest,
        id: "Seed Pack",
        name: "",
        version: " ",
        room: "",
        thumbnail: "",
        economy: { sinks: ["seedpack", "seedpack"] },
        results: { leaderboard: "score-desc", affectsScars: true },
      }),
    ).toEqual([
      "id must be a lowercase slug of at most 32 chars",
      "name is required",
      "version is required",
      "room is required",
      "thumbnail is required",
      "sdk-frame venues cannot affect scars",
      "sdk-frame venues cannot report results",
      "economy sinks must be unique",
    ]);
  });
});
