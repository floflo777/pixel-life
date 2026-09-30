/**
 * In-memory `VenueHost` for unit-testing native venues without a browser, renderer or server. It follows the same rules as
 * the real shell: quotes come from `@pl/shared` `quote()`, requests are confirmed, rejected for guests/loaners, debited
 * from a simulated balance and applied to the Friend's scars; reported results apply `lostDelta` like the server does.
 */
import {
  applyLoss,
  applyRestore,
  ECON,
  type EconomyAction,
  type EconomyQuote,
  type EconomyReceipt,
  effectiveLost,
  EMPTY_MASK,
  familyIdFromName,
  fromIndices,
  frontMask,
  type FriendView,
  isSubset,
  mulberry32,
  quote,
  type DailySeed,
  type ScarState,
  subjectOf,
  payerOf,
} from "@pl/shared";
import {
  canEnter,
  type NativeVenue,
  type QualityTier,
  type ReadonlySignal,
  type ResultAck,
  type SharedStage,
  type VenueHost,
  type VenueIdentity,
  type VenueInstance,
  type VenueResult,
} from "./contract.js";

/** Default start of the harness clock (ms); `testFriendView` anchors scars here so they do not pre-heal. */
export const TEST_START_TIME = 1_800_000_000_000;

/** A writable signal: `signal` is handed to venues, `set` stays with the owner. */
export interface WritableSignal<T> {
  readonly signal: ReadonlySignal<T>;
  set(value: T): void;
}

/** Creates a signal; `set` notifies subscribers only when the value changes (`Object.is`). */
export function createSignal<T>(initial: T): WritableSignal<T> {
  let value = initial;
  const subs = new Set<(v: T) => void>();
  return {
    signal: {
      get value() {
        return value;
      },
      subscribe(cb) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    },
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const cb of [...subs]) cb(next);
    },
  };
}

/** Why the test host rejected an economy request (mirrors the server's `ApiErrorCode`s where they overlap). */
export type TestHostErrorCode = "guest_forbidden" | "not_owner" | "not_lost" | "insufficient_funds" | "cancelled";

/** Error thrown by the test host's economy. */
export class TestHostError extends Error {
  /** Machine-readable reason. */
  readonly code: TestHostErrorCode;
  constructor(code: TestHostErrorCode) {
    super(code);
    this.name = "TestHostError";
    this.code = code;
  }
}

/** A stage whose frame loop is driven manually by the test (`harness.frame(dt)`). */
export interface TestStage extends SharedStage {
  /** Number of live `onFrame` subscriptions (lets tests assert that `unmount` cleaned up). */
  readonly listeners: number;
}

/** Options for `createTestVenueHost`. Every field has a deterministic default. */
export interface TestVenueHostOptions {
  identity?: VenueIdentity;
  balanceMicro?: number;
  /** Start time of the manual clock, ms. */
  startTime?: number;
  /** Simulates the shell's confirm dialog; default: always confirm. */
  confirm?: (q: EconomyQuote) => boolean | Promise<boolean>;
  dailySeed?: DailySeed;
  /** Seed for `seeds.free()`. */
  freeSeed?: number;
  reducedMotion?: boolean;
  quality?: QualityTier;
}

/** Everything a venue did against the host, in call order. */
export interface TestHostLog {
  quotes: EconomyQuote[];
  receipts: EconomyReceipt[];
  results: VenueResult[];
  cues: string[];
  exits: ("done" | "quit" | undefined)[];
}

/** The harness: the `host` to mount a venue on, plus controls and recorded calls. */
export interface TestVenueHarness {
  readonly host: VenueHost<TestStage>;
  readonly log: TestHostLog;
  /** Current simulated balance (micro-RF). */
  readonly balanceMicro: number;
  /** Current manual clock (ms). */
  readonly now: number;
  /** Advances the manual clock. */
  advance(ms: number): void;
  /** Runs one frame: calls every `onFrame` subscriber with `dt` seconds and `alpha`. */
  frame(dt: number, alpha?: number): void;
  setPaused(p: boolean): void;
  setMuted(m: boolean): void;
  /** Mounts `venue` if `identity` may enter it; throws `TestHostError("guest_forbidden")` otherwise. */
  mount(venue: NativeVenue<TestStage>): Promise<VenueInstance>;
}

/**
 * A small, deterministic owner Friend for tests: a 6x6 block (36 px) in every frame, family Mask, token "344030".
 * `lost` defaults to none; scars are anchored at `now` (default `TEST_START_TIME`).
 */
export function testFriendView(
  opts: { tokenId?: string; lost?: string; loaned?: boolean; now?: number } = {},
): FriendView {
  const idx: number[] = [];
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) idx.push(y * 16 + x);
  const frame = fromIndices(idx);
  const tokenId = opts.tokenId ?? "344030";
  const now = opts.now ?? TEST_START_TIME;
  return {
    appearance: {
      tokenId,
      familyId: familyIdFromName("Mask"),
      seed: 1,
      frames: Array.from({ length: 64 }, () => frame),
    },
    pub: {
      tokenId,
      scars: { lost: opts.lost ?? EMPTY_MASK, updatedAt: now, version: 0 },
      goldHeld: 0,
      glowCracks: 0,
      streak: 0,
      lastSeen: now,
      economy: "sim",
    },
    loaned: opts.loaned ?? false,
  };
}

/**
 * Creates an in-memory `VenueHost` plus controls; see the module doc for the rules it enforces.
 * Scar changes replace `host.identity.friend` (never mutate the old FriendView), so tests read the live Friend from it.
 */
export function createTestVenueHost(opts: TestVenueHostOptions = {}): TestVenueHarness {
  // Copied so scar updates never leak into the caller's object.
  const identity: VenueIdentity = { ...(opts.identity ?? { mode: "owner", friend: testFriendView(), loaned: false }) };
  let now = opts.startTime ?? TEST_START_TIME;
  let balance = opts.balanceMicro ?? ECON.simStartMicro;
  let receiptSeq = 0;
  const nextFree = mulberry32(opts.freeSeed ?? 1);
  const paused = createSignal(false);
  const muted = createSignal(false);
  const frameSubs = new Set<(dt: number, alpha: number) => void>();
  const log: TestHostLog = { quotes: [], receipts: [], results: [], cues: [], exits: [] };
  const tokenId = identity.friend.appearance.tokenId;
  const isOwner = identity.mode === "owner" && !identity.loaned;

  const stage: TestStage = {
    quality: opts.quality ?? "high",
    get listeners() {
      return frameSubs.size;
    },
    onFrame(cb) {
      frameSubs.add(cb);
      return () => frameSubs.delete(cb);
    },
  };

  const scars = (): ScarState => identity.friend.pub.scars;
  const setScars = (s: ScarState): void => {
    identity.friend = { ...identity.friend, pub: { ...identity.friend.pub, scars: s } };
  };
  const regrowOpts = () => ({ goldHeld: identity.friend.pub.goldHeld });

  const host: VenueHost<TestStage> = {
    identity,
    stage,
    audio: {
      play(cue) {
        if (!muted.signal.value) log.cues.push(cue);
      },
      muted: muted.signal,
    },
    reducedMotion: opts.reducedMotion ?? false,
    paused: paused.signal,
    economy: {
      async quote(action: EconomyAction) {
        const q = quote(action, "sim");
        log.quotes.push(q);
        return q;
      },
      async request(action: EconomyAction) {
        if (!isOwner) throw new TestHostError("guest_forbidden");
        if (payerOf(action) !== tokenId) throw new TestHostError("not_owner");
        const q = quote(action, "sim");
        const healsSelf = subjectOf(action) === tokenId;
        if (healsSelf && !isSubset(action.pixels, effectiveLost(scars(), now, tokenId, regrowOpts()))) {
          throw new TestHostError("not_lost");
        }
        if (q.totalMicro > balance) throw new TestHostError("insufficient_funds");
        if (!(await (opts.confirm ?? (() => true))(q))) throw new TestHostError("cancelled");
        balance -= q.totalMicro;
        if (healsSelf) setScars(applyRestore(scars(), action.pixels, now, tokenId, regrowOpts()));
        const receipt: EconomyReceipt = {
          id: `test-receipt-${++receiptSeq}`,
          quote: q,
          scars: scars(),
          balanceMicro: balance,
        };
        log.receipts.push(receipt);
        return receipt;
      },
    },
    seeds: {
      async daily() {
        return opts.dailySeed ?? { day: "2026-09-30", seed: 42, endsAt: now + 3_600_000 };
      },
      free() {
        return nextFree();
      },
    },
    async reportResult(result: VenueResult): Promise<ResultAck> {
      log.results.push(result);
      if (!isOwner) return { runId: result.runId, verified: "pending", applied: false, reason: "guest", scars: null };
      const front = frontMask(identity.friend.appearance);
      setScars(applyLoss(scars(), result.claimed.lostDelta, now, tokenId, { ...regrowOpts(), front }));
      return { runId: result.runId, verified: "pending", applied: true, scars: scars() };
    },
    exit(reason) {
      log.exits.push(reason);
    },
  };

  return {
    host,
    log,
    get balanceMicro() {
      return balance;
    },
    get now() {
      return now;
    },
    advance(ms) {
      if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError("advance() takes a non-negative integer of ms.");
      now += ms;
    },
    frame(dt, alpha = 0) {
      for (const cb of [...frameSubs]) cb(dt, alpha);
    },
    setPaused: (p) => paused.set(p),
    setMuted: (m) => muted.set(m),
    async mount(venue) {
      if (!canEnter(venue.manifest, identity)) throw new TestHostError("guest_forbidden");
      return venue.mount(host);
    },
  };
}
