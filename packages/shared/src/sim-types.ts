/**
 * Contract of the deterministic Pixel Life simulation (architecture §2.1). Types and constants only: T2 implements them
 * under `src/sim/` (e.g. `export const createSim: CreateSim = ...`) and must not change these shapes without a PR to T1.
 */
import type { FamilyId, Hex64 } from "./ids.js";

/** Fixed simulation rate in ticks per second. */
export const SIM_HZ = 60;
/** Ticks in one 60-second run. */
export const RUN_TICKS = 3600;

/** Run flavour: `free` runs apply immediately; `daily` runs use the server seed and are replay-verified. */
export type RunKind = "free" | "daily";

/** Everything that determines a run besides inputs. Two sims with equal configs and inputs produce equal hashes. */
export interface SimConfig {
  seed: number;
  kind: RunKind;
  arena: string;
  friend: { front: Hex64; lost: Hex64; familyId: FamilyId; goldHeld: number };
}

/** One player input at tick `t`. `k: 0` = fling (angle 0..4095, power 0..1023); `k: 1` = sweep/steer toggle. */
export type SimInput =
  | { t: number; k: 0 /* fling */; ang: number /* 0..4095 */; pow: number /* 0..1023 */ }
  | { t: number; k: 1 /* sweep/steer */; dir: number /* 0..4095 */; on: 0 | 1 };

/** Gameplay event types emitted by the sim for feedback (sound, juice, HUD). */
export type SimEventType = "hit" | "bite" | "pixelOff" | "pixelBack" | "pixelLost" | "smash" | "edge" | "end";

/** A gameplay event at tick `t`; `a`/`b` are event-specific ids (e.g. creature, pixel), `x`/`z` a world position. */
export interface SimEvent {
  t: number;
  type: SimEventType;
  a?: number;
  b?: number;
  x?: number;
  z?: number;
}

/**
 * Read-only snapshot the renderer draws from. Deliberately minimal here: T2 owns the gameplay state layout and extends
 * this interface (in a PR to shared) with what the renderer needs; renderers must treat it as immutable.
 */
export interface SimView {
  readonly tick: number;
  readonly score: number;
}

/** Result of a finished (or replayed) run; `finalHash` is the determinism checksum the server compares. */
export interface RunSummary {
  score: number;
  lostDelta: Hex64;
  recovered: number;
  smashed: number;
  ticks: number;
  finalHash: string;
}

/** A running simulation. `step` advances exactly one tick with the inputs stamped for that tick. */
export interface Sim {
  readonly tick: number;
  readonly done: boolean;
  step(inputs: readonly SimInput[]): void;
  view(): SimView;
  drainEvents(): SimEvent[];
  hash(): string;
  summary(): RunSummary;
}

/** `createSim(cfg)`: builds a sim at tick 0. */
export type CreateSim = (cfg: SimConfig) => Sim;
/** `replay(cfg, inputs)`: headless full run, used by the server to verify claimed summaries. */
export type Replay = (cfg: SimConfig, inputs: readonly SimInput[]) => RunSummary;
/** `encodeInputs(inputs)`: compact binary input log (uploaded base64 in `POST /api/runs`). */
export type EncodeInputs = (i: readonly SimInput[]) => Uint8Array;
/** `decodeInputs(bytes)`: inverse of `encodeInputs`; throws on malformed logs. */
export type DecodeInputs = (b: Uint8Array) => SimInput[];
/** `dailySeed(day, secretHmacHex)`: server-side daily seed; clients receive it via `GET /api/daily`. */
export type DailySeedFn = (day: string, secretHmacHex: string) => number;
