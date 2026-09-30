/**
 * The venue registry (architecture §1b.2): every venue the hub has a door for. Native venues run in-process on the
 * shared stage with the full `VenueHost` and load lazily; SDK venues are stock FriendSDK games mounted unmodified in
 * the sandbox through `ConnectedGameHost`. A venue gets a hall on the island only when it is listed here (GDD §11:
 * no "coming soon" scaffolds), so adding an entry is what puts a new game on the map.
 */
import { SEED_PACK } from "@pl/shared";
import type { NativeVenue, SdkFrameVenue, VenueManifest } from "@pl/venue-kit";
import type { GameStage } from "../stage/runtime.js";

/** How a door starts a venue: a free run, or today's Daily (Daily Gate). */
export type VenueMode = "quick" | "daily";

/** Options passed to a native venue's loader. */
export interface VenueLoadOptions {
  readonly mode: VenueMode;
}

/** A native venue whose code is fetched on demand. */
export interface NativeVenueEntry {
  manifest: VenueManifest & { kind: "native" };
  /** One sentence shown on the hub's venue card (GDD §11.5). */
  rule: string;
  /** Modes the venue card offers. */
  modes: readonly VenueMode[];
  load(opts: VenueLoadOptions): Promise<NativeVenue<GameStage>>;
}

/** An SDK booth with the copy its venue card shows. */
export interface SdkVenueEntry extends SdkFrameVenue {
  rule: string;
}

/** Loose Pixels, the flagship venue, on the real deterministic sim with the real creature views. */
export const PIXEL_LIFE: NativeVenueEntry = {
  manifest: {
    id: "pixel-life",
    name: "Loose Pixels",
    version: "0.1.0",
    kind: "native",
    room: "pixel-arena",
    requires: { ownedFriend: false },
    economy: { sinks: ["regrow", "mend"] },
    results: { leaderboard: "score-desc", affectsScars: true },
    thumbnail: "/favicon.svg",
  },
  rule: "Every hit knocks a pixel off your Friend. Grab it back, or regrow it.",
  modes: ["quick", "daily"],
  load: async ({ mode }) => {
    const [game, shared, creatures] = await Promise.all([
      import("@pl/game"),
      import("@pl/shared"),
      import("./creatures.js"),
    ]);
    // The real deterministic sim from @pl/shared drives the venue (same code the server replays).
    const sim = { createSim: shared.createSim, encodeInputs: shared.encodeInputs } as unknown as Parameters<
      typeof game.createLoosePixelsVenue
    >[0]["sim"];
    return game.createLoosePixelsVenue({
      sim,
      creatureFactory: creatures.realCreatureFactory(),
      ...(mode === "daily" ? { autoStart: "daily" as const } : {}),
    }) as unknown as NativeVenue<GameStage>;
  },
};

/**
 * The Handheld Arcade: Loose Pixels in 1-bit 128×128 on the real sim (same scars and boards), a 2D overlay on the
 * stage's container. Its hall stands on the plaza's east rim. The manifest mirrors `handheld.HANDHELD_MANIFEST`
 * (kept static so `@pl/game` stays lazy) except `room`, which names where its door actually is.
 */
export const HANDHELD: NativeVenueEntry = {
  manifest: {
    id: "handheld",
    name: "Handheld Arcade",
    version: "0.2.0",
    kind: "native",
    room: "plaza",
    requires: { ownedFriend: false },
    economy: { sinks: ["regrow"] },
    results: { leaderboard: "score-desc", affectsScars: true },
    thumbnail: "/favicon.svg",
  },
  rule: "Loose Pixels on a 1-bit pocket screen: same Friend, same scars, same boards.",
  modes: ["quick"],
  load: async () => (await import("@pl/game")).handheld.createHandheldVenue() as unknown as NativeVenue<GameStage>,
};

/**
 * Pixel Putt: scarless floating mini-golf (GDD §11.8 A) by the Mend Well on the sky docks. Free rounds earn Bits only:
 * no scars, no boards. The manifest mirrors `PIXEL_PUTT_MANIFEST` (kept static so `@pl/game` stays lazy).
 */
export const PIXEL_PUTT: NativeVenueEntry = {
  manifest: {
    id: "pixel-putt",
    name: "Pixel Putt",
    version: "0.1.0",
    kind: "native",
    room: "sky-docks",
    requires: { ownedFriend: false },
    economy: { sinks: [] },
    results: { leaderboard: "score-desc", affectsScars: false },
    thumbnail: "/favicon.svg",
  },
  rule: "Fling your Friend into the hole in the fewest shots. No scars here: a round for healing days.",
  modes: ["quick"],
  load: async () => (await import("@pl/game")).createPixelPuttVenue() as unknown as NativeVenue<GameStage>,
};

/**
 * Bump Sumo: a 4-Friend ring-out party game (GDD §11.8 B) against three real loaner Friends, never the player's own.
 * Scarless: pixels knocked off reattach at the bout's end. Its hall is on the plaza's west rim and on the arena isle.
 * The manifest mirrors `BUMP_SUMO_MANIFEST` (kept static so `@pl/game` stays lazy).
 */
export const BUMP_SUMO: NativeVenueEntry = {
  manifest: {
    id: "bump-sumo",
    name: "Bump Sumo",
    version: "0.1.0",
    kind: "native",
    room: "plaza",
    requires: { ownedFriend: false },
    economy: { sinks: [] },
    results: { leaderboard: "score-desc", affectsScars: false },
    thumbnail: "/favicon.svg",
  },
  rule: "Shove the other Friends off the island. Last one standing wins. Knocked-off pixels come back after the bout.",
  modes: ["quick"],
  load: async () => {
    const [game, loaners] = await Promise.all([import("@pl/game"), import("../identity/loaners.js")]);
    return game.createBumpSumoVenue({
      rivals: () => loaners.loadLoaners().then((l) => l.map((f) => f.appearance)),
    }) as unknown as NativeVenue<GameStage>;
  },
};

/** The Seed Pack Booth: the stock SDK game in `apps/seed-pack`, built to `/venues/seed-pack/`. */
export const SEED_PACK_BOOTH: SdkVenueEntry = {
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
  rule: "Open a Seed Pack with your own Friend: the odds are published, every pull is on the ledger.",
  frameUrl: "/venues/seed-pack/game.html",
  definition: SEED_PACK,
  // Same layout variables as apps/seed-pack/host.css (3:2 desktop, 3:4 phones via the CSS media query).
  hostCss: { "--rf-game-max-width": "960px" },
};

/** Native venues by id. */
export const NATIVE_VENUES: Readonly<Record<string, NativeVenueEntry>> = {
  "pixel-life": PIXEL_LIFE,
  handheld: HANDHELD,
  "pixel-putt": PIXEL_PUTT,
  "bump-sumo": BUMP_SUMO,
};
/** SDK venues by id. */
export const SDK_VENUES: Readonly<Record<string, SdkVenueEntry>> = { "seed-pack": SEED_PACK_BOOTH };

/** Every venue id with a door in the hub (passed to the hub scene, which builds only these optional halls). */
export function venueIds(): string[] {
  return [...Object.keys(NATIVE_VENUES), ...Object.keys(SDK_VENUES)];
}

/** The native venue for `id` (default: the flagship), or null for an unknown id. */
export function nativeVenue(id: string | null | undefined): NativeVenueEntry | null {
  if (!id) return PIXEL_LIFE;
  return NATIVE_VENUES[id] ?? null;
}
