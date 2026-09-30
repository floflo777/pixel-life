import { parentPort } from "node:worker_threads";
import { RUN_TICKS, type CreateSim, type DecodeInputs, type Replay, type SimInput } from "@pl/shared";
import { emptyTally, tallyEvent, type RunTally } from "./facts.js";
import { sameSummary, type ReplayOutcome, type WorkerRequest, type WorkerResponse } from "./replay-protocol.js";

/**
 * Worker-thread entry: replays runs headlessly with `replay()` from @pl/shared (architecture §4.6, hosting decision:
 * "replay verification in a worker thread"). The sim is resolved at runtime so this file builds before the sim lands:
 * without `replay`/`decodeInputs` exports every job answers `unavailable` and runs stay pending.
 *
 * A verified run is then played once more through `createSim` with events on, to count the per-run metrics stamps and
 * belts need (`replay()` skips events for speed). That second pass is informative only: if it cannot run or does not
 * land on the verified summary, the outcome stays `ok` without a tally.
 */

interface SimApi {
  readonly replay: Replay;
  readonly decodeInputs: DecodeInputs;
  readonly createSim: CreateSim | null;
}

let api: Promise<SimApi | null> | undefined;

function loadSim(): Promise<SimApi | null> {
  api ??= import("@pl/shared").then((mod) => {
    const exports = mod as unknown as Record<string, unknown>;
    const replay = exports["replay"];
    const decodeInputs = exports["decodeInputs"];
    const createSim = exports["createSim"];
    if (typeof replay !== "function" || typeof decodeInputs !== "function") return null;
    return {
      replay: replay as Replay,
      decodeInputs: decodeInputs as DecodeInputs,
      createSim: typeof createSim === "function" ? (createSim as CreateSim) : null,
    };
  });
  return api;
}

/** Re-plays the (already validated, tick-sorted) log with events on, applying inputs exactly as `replay` does. */
function tallyRun(sim: SimApi, request: WorkerRequest, inputs: readonly SimInput[]): RunTally | undefined {
  if (!sim.createSim) return undefined;
  try {
    const s = sim.createSim(request.job.config);
    const tally = emptyTally();
    const batch: SimInput[] = [];
    let i = 0;
    while (!s.done && s.tick < RUN_TICKS) {
      batch.length = 0;
      while (i < inputs.length && (inputs[i]?.t ?? Infinity) <= s.tick) {
        const input = inputs[i++];
        if (input && input.t === s.tick) batch.push(input);
      }
      s.step(batch);
      for (const e of s.drainEvents()) tallyEvent(tally, e);
    }
    return sameSummary(s.summary(), request.job.claimed) ? tally : undefined;
  } catch {
    return undefined;
  }
}

async function run(request: WorkerRequest): Promise<ReplayOutcome> {
  const sim = await loadSim();
  if (!sim) return { status: "unavailable", detail: "@pl/shared does not export replay() yet" };
  let summary;
  let inputs: SimInput[];
  try {
    inputs = sim.decodeInputs(new Uint8Array(Buffer.from(request.job.inputs, "base64")));
    summary = sim.replay(request.job.config, inputs);
  } catch (error) {
    return { status: "mismatch", summary: null, detail: error instanceof Error ? error.message : String(error) };
  }
  if (!sameSummary(summary, request.job.claimed)) {
    return { status: "mismatch", summary, detail: "replay diverged from the claimed summary" };
  }
  const tally = tallyRun(sim, request, inputs);
  return tally ? { status: "ok", summary, tally } : { status: "ok", summary };
}

const port = parentPort;
if (!port) throw new Error("replay-worker must run in a worker thread");
port.on("message", (request: WorkerRequest) => {
  void run(request)
    .catch((error: unknown): ReplayOutcome => ({ status: "error", detail: String(error) }))
    .then((outcome) => port.postMessage({ id: request.id, outcome } satisfies WorkerResponse));
});
