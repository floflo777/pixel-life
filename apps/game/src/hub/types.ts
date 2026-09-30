/** Public types of the hub scene (architecture §2.1 `createHubScene(stage, net, identity) → HubScene`). */
import type { Object3D } from "three";
import type {
  EmoteName,
  Facing,
  FriendAppearance,
  FriendPublic,
  Hex64,
  RoomSlug,
  SkyFriend,
  TokenIdStr,
} from "@pl/shared";
import type { CueName, PlayParams, ThemeName } from "@pl/audio";
import type { HubNetState } from "./net";

/** What the hub needs from a Friend model. `buildFriendModel` from `../friend` satisfies it (its extras are used). */
export interface HubFriendModel {
  readonly object: Object3D;
  setPose(facing: Facing, walking: boolean, frame: number): void;
  setLost(lost: Hex64): void;
  dispose(): void;
  setLod?(lod: 0 | 1 | 2): void;
  setGold?(gold: number): void;
  setStitched?(stitched: Hex64): void;
  /** Geometric halo tint (streak tier). */
  setHaloColor?(color: number): void;
  /** Height of the tallest column (world units), for tags and bubbles. */
  readonly height?: number;
}

/** Options the hub passes when building a Friend model. */
export interface HubFriendModelOptions {
  gold: number;
  lod: 0 | 1 | 2;
  stitched?: Hex64;
  /**
   * Near Friends use the model's geometric halo (paper ring + ink keyline) so overlapping Friends stay separate
   * shapes; `false` leaves the halo to the stage's screen-space pass.
   */
  halo?: false | { color: number };
}

/** The injection seam for Friend models (tests and tools can pass a lighter one). */
export type FriendModelFactory = (a: FriendAppearance, lost: Hex64, opts: HubFriendModelOptions) => HubFriendModel;

/** Where the hub gets Friend data (REST in the shell, fixtures in the dev page). Both may be cached by the caller. */
export interface HubFriendSource {
  /** Immutable on-chain art (`/api/friends/:id/appearance`). */
  appearance(tokenId: TokenIdStr): Promise<FriendAppearance>;
  /** Public state (`/api/friends/:id/public`); `fresh` bypasses caches after a `scars`/`mended` event. */
  publicState(tokenId: TokenIdStr, fresh?: boolean): Promise<FriendPublic>;
}

/** Audio the hub plays; `AudioEngine` from `@pl/audio` satisfies it. */
export interface HubAudio {
  play(cue: CueName, params?: Readonly<PlayParams>): unknown;
  readonly music?: { play(theme: ThemeName): void; stop(options?: { at?: "now" | "bar"; fade?: number }): void };
}

/** A venue door was entered. */
export interface VenueEntry {
  readonly venueId: string;
  /** Venue mode from the door (e.g. `daily` at the Daily Gate), or null. */
  readonly mode: string | null;
  readonly room: RoomSlug;
}

/** Fling Belts (GDD §12.4), worn as a 1-voxel band on the waist row. */
export type FlingBelt =
  "white" | "yellow" | "orange" | "green" | "blue" | "red" | "brown" | "purple" | "black" | "gulp-master";

/** Scene options beyond the architecture's three parameters. */
export interface HubSceneOptions {
  readonly friends: HubFriendSource;
  /** Friend model factory (default: the voxel `buildFriendModel` with the screen-space halo). */
  readonly buildFriend?: FriendModelFactory;
  readonly audio?: HubAudio;
  /** Overlay host positioned exactly over the canvas (default: a new div in the canvas's parent). */
  readonly overlay?: HTMLElement;
  /** Resting (offline) Friends for a room (`GET /api/sky?room=`); called on every room entry. */
  readonly resting?: (room: RoomSlug) => Promise<readonly SkyFriend[]> | readonly SkyFriend[];
  /** Emotes the player can use (GDD §11.4: 4 at start). Default: all 8. */
  readonly unlockedEmotes?: readonly EmoteName[];
  /** A Friend's current Fling Belt (null/undefined: none). Read when its voxel model is built. */
  readonly beltOf?: (tokenId: TokenIdStr) => FlingBelt | null | undefined;
  /**
   * Festival / event hook (GDD §12.6 Sky Festivals, Lost Pixel hunt): called each time a room is shown with its
   * static root, so decorations can be added; the returned function (if any) runs when the room is left.
   */
  readonly decorate?: (room: RoomSlug, root: Object3D) => (() => void) | undefined;
  /** Wall clock for regrowth maths (default `Date.now`). */
  readonly now?: () => number;
  /**
   * Optional venue halls to build, by venue id (the shell passes its registry, so a door exists only for a venue that
   * ships: GDD §11, no "coming soon" scaffolds). Core doors are always built. Default: every hall (dev page).
   */
  readonly venues?: readonly string[];
  /** Starting room (default plaza). */
  readonly room?: RoomSlug;
  readonly onEnterVenue?: (e: VenueEntry) => void;
  readonly onRoomChange?: (room: RoomSlug) => void;
  /** A scarred Friend (not yours) was tapped: open the Mend mini card / confirm. */
  readonly onMendRequest?: (tokenId: TokenIdStr) => void;
  /** Any other Friend was tapped (mini card). */
  readonly onFriendTap?: (tokenId: TokenIdStr) => void;
  /** Connection/loading state for the shell's loading / error / retry UI. */
  readonly onState?: (s: HubNetState | "error", detail?: string) => void;
}

/** Live counters for the perf HUD and tests. */
export interface HubStats {
  presences: number;
  resting: number;
  near: number;
  far: number;
  impostorPixels: number;
  tags: number;
  bubbles: number;
  /** Scene JS time per frame (ms, last frame). */
  frameMs: number;
}

/** The running hub. */
export interface HubScene {
  /** Current room (null before the first join). */
  readonly room: RoomSlug | null;
  /** Joins a room (default: the current or starting room). Resolves once presence is live. */
  enter(room?: RoomSlug, from?: RoomSlug | null): Promise<void>;
  /** Plays an emote (respecting unlocks and the 1.5 s cooldown). Returns whether it was sent. */
  emote(name: EmoteName): boolean;
  /** Says a quick-chat phrase by id. Returns whether it was sent. */
  say(phraseId: number): boolean;
  /** Walks your Friend to a wire point (click-to-move). */
  walkTo(x: number, z: number): boolean;
  /** Walks next to a Friend in the room (e.g. after a Mend confirm). */
  walkToFriend(tokenId: TokenIdStr): boolean;
  /** Back from a venue: clears the venue status. */
  exitVenue(): void;
  /** Replaces the resting Friends of the current room. */
  setResting(list: readonly SkyFriend[]): void;
  /** Live player counts per venue for the door pills (from the directory). */
  setVenueCounts(counts: Readonly<Record<string, number>>): void;
  /** Block/mute a Friend's emotes and quick chat for you (GDD §11.3). */
  setMuted(tokenId: TokenIdStr, muted: boolean): void;
  /** Re-fetches a Friend's public state (scars, gold, stitches). */
  refreshFriend(tokenId: TokenIdStr): void;
  readonly stats: Readonly<HubStats>;
  dispose(): void;
}
