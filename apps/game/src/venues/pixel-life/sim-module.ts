/**
 * The sim the venue runs: the real deterministic `@pl/shared` simulation (the same code the server replays). The venue
 * reads `SimView` / `SimEvent` from `@pl/shared` directly; this file only adds the injectable module shape (tests can
 * wrap the sim, e.g. to count steps) and readable names for the contract's numeric codes.
 */
import {
  createSim,
  encodeInputs,
  SIM_VERSION,
  SimTuning,
  type SimConfig,
  type SimInput,
  type Sim,
} from "@pl/shared";

/** A sim implementation: `createSim` + `encodeInputs` with the `@pl/shared` signatures. */
export interface SimModule {
  /** Short label for dev overlays ("shared@1"). */
  readonly name?: string;
  createSim(cfg: SimConfig): Sim;
  /** Compact input log for `reportResult` (the server replays it with `replay`). */
  encodeInputs(inputs: readonly SimInput[]): Uint8Array;
}

/** The real sim from `@pl/shared` (the venue's default). */
export const SHARED_SIM: SimModule = { name: `shared@${SIM_VERSION}`, createSim, encodeInputs };

/** Creature kinds (`SimCreatureView.kind`), from the sim's tuning table. */
export const KIND = {
  nib: SimTuning.NIB,
  pogo: SimTuning.POGO,
  clank: SimTuning.CLANK,
  snatch: SimTuning.SNATCH,
  slurp: SimTuning.SLURP,
  fizz: SimTuning.FIZZ,
} as const;

/** Pixel states in `SimFriendView.pixels` (documented in `sim-types.ts`: 0 none … 5 old scar). */
export const PX = { none: 0, body: 1, loose: 2, lost: 3, safety: 4, oldScar: 5 } as const;
