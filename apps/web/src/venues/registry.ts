/**
 * Venues the hub can open (architecture §1b.2). Native venues run in-process with the full `VenueHost`; SDK venues are
 * stock FriendSDK games mounted unmodified in the sandbox through `ConnectedGameHost`.
 *
 * Pixel Life itself lands with T5 (`pixelLifeVenue` from `@pl/game`): until then the "pixel-life" slot mounts a
 * clearly labelled placeholder native venue that exercises the whole host contract (stage, input, audio, scars,
 * results). Replace `load` below when the real venue is merged.
 */
import { SEED_PACK } from "@pl/shared";
import type { NativeVenue, SdkFrameVenue, VenueManifest } from "@pl/venue-kit";
import type { GameStage } from "../stage/runtime.js";

/** A native venue whose code is fetched on demand. */
export interface NativeVenueEntry {
  manifest: VenueManifest & { kind: "native" };
  load(): Promise<NativeVenue<GameStage>>;
}

/** Pixel Life (placeholder until T5). */
export const PIXEL_LIFE: NativeVenueEntry = {
  manifest: {
    id: "pixel-life",
    name: "Pixel Life",
    version: "0.0.1-placeholder",
    kind: "native",
    room: "pixel-arena",
    requires: { ownedFriend: false },
    economy: { sinks: ["regrow", "mend"] },
    results: { leaderboard: "score-desc", affectsScars: true },
    thumbnail: "/favicon.svg",
  },
  load: () => import("./placeholder-venue.js").then((m) => m.placeholderPixelLife),
};

/** The Seed Pack Booth: the stock SDK game in `apps/seed-pack`, built to `/venues/seed-pack/`. */
export const SEED_PACK_BOOTH: SdkFrameVenue = {
  manifest: {
    id: "seed-pack",
    name: "Seed Pack Booth",
    version: "0.1.0",
    kind: "sdk-frame",
    room: "seed-booth",
    requires: { ownedFriend: true },
    economy: { sinks: ["seedpack"], chanceGame: SEED_PACK },
    results: { affectsScars: false },
    thumbnail: "/favicon.svg",
  },
  frameUrl: "/venues/seed-pack/game.html",
  definition: SEED_PACK,
  // Same layout variables as apps/seed-pack/host.css (3:2 desktop, 3:4 phones via the CSS media query).
  hostCss: { "--rf-game-max-width": "960px" },
};

/** Native venues by id. */
export const NATIVE_VENUES: Readonly<Record<string, NativeVenueEntry>> = { "pixel-life": PIXEL_LIFE };
/** SDK venues by id. */
export const SDK_VENUES: Readonly<Record<string, SdkFrameVenue>> = { "seed-pack": SEED_PACK_BOOTH };
