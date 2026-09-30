import { parentPort } from "node:worker_threads";
import type { DecodeInputs, Replay } from "@pl/shared";
import { sameSummary, type ReplayOutcome, type WorkerRequest, type WorkerResponse } from "./replay-protocol.js";

/**
 * Worker-thread entry: replays runs headlessly with `replay()` from @pl/shared (architecture §4.6, hosting decision:
 * "replay verification in a worker thread"). The sim is resolved at runtime so this file builds before the sim lands:
 * without `replay`/`decodeInputs` exports every job answers `unavailable` and runs stay pending.
 */

interface SimApi {
  readonly replay: Replay;
  readonly decodeInputs: DecodeInputs;
}

let api: Promise<SimApi | null> | undefined;

function loadSim(): Promise<SimApi | null> {
  api ??= import("@pl/shared").then((mod) => {
    const exports = mod as unknown as Record<string, unknown>;
    const replay = exports["replay"];
    const decodeInputs = exports["decodeInputs"];
    if (typeof replay !== "function" || typeof decodeInputs !== "function") return null;
    return { replay: replay as Replay, decodeInputs: decodeInputs as DecodeInputs };
  });
  return api;
}

async function run(request: WorkerRequest): Promise<ReplayOutcome> {
  const sim = await loadSim();
  if (!sim) return { status: "unavailable", detail: "@pl/shared does not export replay() yet" };
  let summary;
  try {
    const inputs = sim.decodeInputs(new Uint8Array(Buffer.from(request.job.inputs, "base64")));
    summary = sim.replay(request.job.config, inputs);
  } catch (error) {
    return { status: "mismatch", summary: null, detail: error instanceof Error ? error.message : String(error) };
  }
  return sameSummary(summary, request.job.claimed)
    ? { status: "ok", summary }
    : { status: "mismatch", summary, detail: "replay diverged from the claimed summary" };
}

const port = parentPort;
if (!port) throw new Error("replay-worker must run in a worker thread");
port.on("message", (request: WorkerRequest) => {
  void run(request)
    .catch((error: unknown): ReplayOutcome => ({ status: "error", detail: String(error) }))
    .then((outcome) => port.postMessage({ id: request.id, outcome } satisfies WorkerResponse));
});
