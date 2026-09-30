import type { RunSummary, SimConfig } from "@pl/shared";
import type { RunTally } from "./facts.js";

/** One replay request, as posted to a worker thread (structured-clone safe). */
export interface ReplayJob {
  readonly config: SimConfig;
  /** The uploaded input log, base64 of `encodeInputs(...)`. */
  readonly inputs: string;
  readonly claimed: RunSummary;
}

/**
 * Result of replaying one run:
 * - `ok` / `mismatch`: the replay ran; `mismatch` also covers malformed logs and invalid configs (the client's fault).
 *   `ok` carries the event tally of the verified run (stamps/belts) when the worker could count it;
 * - `unavailable`: this build has no `replay()` yet (the sim ships separately), so the run stays pending;
 * - `error`: infrastructure failure (worker crash, timeout); the run stays pending and may be retried.
 */
export type ReplayOutcome =
  | { readonly status: "ok"; readonly summary: RunSummary; readonly tally?: RunTally }
  | { readonly status: "mismatch"; readonly summary: RunSummary | null; readonly detail: string }
  | { readonly status: "unavailable"; readonly detail: string }
  | { readonly status: "error"; readonly detail: string };

/** Message from the pool to a worker. */
export interface WorkerRequest {
  readonly id: number;
  readonly job: ReplayJob;
}

/** Message from a worker to the pool. */
export interface WorkerResponse {
  readonly id: number;
  readonly outcome: ReplayOutcome;
}

/** Fields a replay must reproduce exactly for a claim to count as verified. */
export function sameSummary(a: RunSummary, b: RunSummary): boolean {
  return a.finalHash === b.finalHash && a.score === b.score && a.lostDelta === b.lostDelta;
}
