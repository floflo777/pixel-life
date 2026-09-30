/**
 * Venue module contract (architecture §1b.2). The hub shell owns identity, economy, persistence and social; a venue owns
 * only gameplay. This package is renderer-agnostic: `SharedStage` and `VenueAudio` are the minimal capabilities every
 * venue may rely on; `@pl/game` passes a richer stage (three.js renderer, scene, camera, input) that structurally extends
 * `SharedStage`, and a native venue that needs it declares `NativeVenue<GameStage>`.
 */
import type {
  ChanceGameJson,
  DailySeed,
  EconomyAction,
  EconomyQuote,
  EconomyReceipt,
  FriendView,
  Hex64,
  RunAck,
  RunKind,
  RunSummary,
} from "@pl/shared";

/** How a venue is mounted: in-process trusted code, or a sandboxed stock FriendSDK game. */
export type VenueKind = "native" | "sdk-frame";

/** RF sinks a venue may route through the hub economy. Venues never price RF themselves. */
export type VenueSink = "regrow" | "mend" | "seedpack";

/** Static description of a venue, shown on its hub door. */
export interface VenueManifest {
  /** Stable slug, e.g. "pixel-life", "seed-pack". */
  id: string;
  name: string;
  version: string;
  kind: VenueKind;
  /** Hub room hosting its door. */
  room: string;
  /** Guests are blocked when `ownedFriend` is true. */
  requires: { ownedFriend: boolean };
  /** `chanceGame` is the SDK `ChanceGameDefinition` JSON for sdk-frame venues. */
  economy: { sinks: readonly VenueSink[]; chanceGame?: ChanceGameJson };
  results: { leaderboard?: "score-desc" | "time-asc"; affectsScars: boolean };
  /** 16x16 1-bit rows or an asset URL. */
  thumbnail: string;
}

/** Who is playing: a guest with a loaned Friend or an owner with their own. */
export interface VenueIdentity {
  mode: "guest" | "owner";
  /** Appearance + live scars/gold. */
  friend: FriendView;
  loaned: boolean;
}

/** A read-only reactive value (the shell's pause state, mute, ...). */
export interface ReadonlySignal<T> {
  readonly value: T;
  /** Calls `cb` on every change (not immediately); returns an unsubscribe function. */
  subscribe(cb: (value: T) => void): () => void;
}

/** Render quality tier chosen adaptively by the shell. */
export type QualityTier = "low" | "medium" | "high";

/**
 * Minimal renderer-agnostic view of the shell's shared stage. `onFrame` delivers the fixed-step frame loop:
 * `dt` in seconds, `alpha` in [0, 1) for render interpolation; it returns an unsubscribe function.
 */
export interface SharedStage {
  onFrame(cb: (dt: number, alpha: number) => void): () => void;
  readonly quality: QualityTier;
}

/** Venue-facing audio: named cues (FriendSDK sound kit + ours). Honours the shell's mute; venues never own a context. */
export interface VenueAudio {
  play(cue: string, opts?: { volume?: number }): void;
  readonly muted: ReadonlySignal<boolean>;
}

/** Economy capability: quotes are pure previews; `request` shows the shell's confirm dialog and rejects for guests. */
export interface VenueEconomy {
  quote(action: EconomyAction): Promise<EconomyQuote>;
  request(action: EconomyAction): Promise<EconomyReceipt>;
}

/** Run seeds: the server's daily seed, or a fresh local seed for a free run. */
export interface VenueSeeds {
  daily(): Promise<DailySeed>;
  free(): number;
}

/** A finished run reported to the shell (which posts it to `POST /api/runs`). */
export interface VenueResult {
  venueId: string;
  runId: string;
  seed: number;
  kind: RunKind;
  inputs: Uint8Array;
  claimed: RunSummary;
  /** Scars the run started from (server replays from them when plausible, see POST /api/runs). */
  startLost?: Hex64;
  /** Wall-clock ms when the run started (pairs with `startLost`). */
  startedAt?: number;
  /** Belt id when this run is a Fling Belt trial (seeded by `beltTrialSeed`). */
  beltTrial?: string;
}

/** The server's acknowledgement of a reported result. */
export type ResultAck = RunAck;

/** Capabilities the trusted shell lends to a NATIVE venue. All economy is quote → host-confirmed request. */
export interface VenueHost<TStage extends SharedStage = SharedStage> {
  identity: VenueIdentity;
  stage: TStage;
  audio: VenueAudio;
  reducedMotion: boolean;
  paused: ReadonlySignal<boolean>;
  economy: VenueEconomy;
  seeds: VenueSeeds;
  reportResult(result: VenueResult): Promise<ResultAck>;
  exit(reason?: "done" | "quit"): void;
}

/** A mounted venue. `unmount` must release every resource it took from the stage. */
export interface VenueInstance {
  pause(p: boolean): void;
  resize(w: number, h: number): void;
  unmount(): Promise<void>;
}

/** A first-party venue running in-process with the full `VenueHost`. */
export interface NativeVenue<TStage extends SharedStage = SharedStage> {
  manifest: VenueManifest;
  mount(host: VenueHost<TStage>): Promise<VenueInstance>;
}

/** SDK-frame venue: a stock FriendSDK game (index.tsx + game.json) built with @rarefriends/friendsdk/build. */
export interface SdkFrameVenue {
  manifest: VenueManifest & { kind: "sdk-frame" };
  frameUrl: string;
  /** SDK `ChanceGameDefinition` JSON (parse with `parseChanceGame` before mounting `ConnectedGameHost`). */
  definition: ChanceGameJson;
  hostCss?: Record<string, string>;
}

/** Any venue the hub can open. */
export type Venue<TStage extends SharedStage = SharedStage> = NativeVenue<TStage> | SdkFrameVenue;

/** True iff `v` is a sandboxed SDK-frame venue (narrowed by the manifest kind). */
export function isSdkFrameVenue<TStage extends SharedStage>(v: Venue<TStage>): v is SdkFrameVenue {
  return v.manifest.kind === "sdk-frame";
}

/** True iff `v` is an in-process native venue. */
export function isNativeVenue<TStage extends SharedStage>(v: Venue<TStage>): v is NativeVenue<TStage> {
  return v.manifest.kind === "native" && "mount" in v;
}

/** Whether `identity` may enter a venue with this manifest (guests are blocked from owner-only venues). */
export function canEnter(manifest: VenueManifest, identity: VenueIdentity): boolean {
  return !manifest.requires.ownedFriend || (identity.mode === "owner" && !identity.loaned);
}

/** Problems with a manifest (empty = valid): slug id, non-empty fields, no scars/leaderboard for sdk-frame venues. */
export function manifestProblems(m: VenueManifest): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(m.id)) problems.push("id must be a lowercase slug of at most 32 chars");
  if (!m.name.trim()) problems.push("name is required");
  if (!m.version.trim()) problems.push("version is required");
  if (!m.room.trim()) problems.push("room is required");
  if (!m.thumbnail.trim()) problems.push("thumbnail is required");
  if (m.kind === "sdk-frame" && m.results.affectsScars) problems.push("sdk-frame venues cannot affect scars");
  // The SDK bridge has no results channel (architecture §1b.2), so sandboxed venues cannot rank runs either.
  if (m.kind === "sdk-frame" && m.results.leaderboard !== undefined)
    problems.push("sdk-frame venues cannot report results");
  if (new Set(m.economy.sinks).size !== m.economy.sinks.length) problems.push("economy sinks must be unique");
  return problems;
}
