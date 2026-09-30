import { Worker } from "node:worker_threads";
import type { ReplayJob, ReplayOutcome, WorkerRequest, WorkerResponse } from "./replay-protocol.js";

/** Replays runs off the event loop. The server's `VERIFY_Q` replacement (hosting decision: worker_threads pool). */
export interface RunVerifier {
  /** Replays one run. Never rejects: failures come back as `error`/`unavailable` outcomes. */
  verify(job: ReplayJob): Promise<ReplayOutcome>;
  /** Terminates the workers; pending jobs resolve as `error`. */
  close(): Promise<void>;
}

/** Pool options. */
export interface ReplayPoolOptions {
  /** Worker threads (lazily started). 0 disables verification: every job is `unavailable`. */
  readonly size: number;
  /** A replay taking longer than this is abandoned and its worker replaced (architecture target: ≤ 15 ms). */
  readonly timeoutMs?: number;
  /** Worker entry override (tests). */
  readonly workerUrl?: URL;
}

interface Pending {
  readonly id: number;
  readonly job: ReplayJob;
  readonly resolve: (outcome: ReplayOutcome) => void;
}

interface Slot {
  worker: Worker;
  busy: Pending | null;
  timer: NodeJS.Timeout | null;
}

/**
 * Where the worker entry lives: from TypeScript source (dev, tests) a bootstrap that registers tsx inside the thread
 * then loads `replay-worker.ts`; in production `replay-worker.mjs` next to the esbuild bundle (scripts/build.mjs).
 */
function defaultWorkerUrl(): URL {
  return import.meta.url.endsWith(".ts")
    ? new URL("./replay-worker.dev.mjs", import.meta.url)
    : new URL("./replay-worker.mjs", import.meta.url);
}

/** A verifier that never verifies (REPLAY_WORKERS=0, or tests that do not care). */
export const disabledVerifier: RunVerifier = {
  verify: async () => ({ status: "unavailable", detail: "replay verification is disabled" }),
  close: async () => undefined,
};

/** Creates a fixed-size pool of replay workers with a FIFO queue, per-job timeout and crash replacement. */
export function createReplayPool(options: ReplayPoolOptions): RunVerifier {
  if (options.size <= 0) return disabledVerifier;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const workerUrl = options.workerUrl ?? defaultWorkerUrl();
  const slots: Slot[] = [];
  const queue: Pending[] = [];
  let seq = 0;
  let closed = false;

  const finish = (slot: Slot, outcome: ReplayOutcome) => {
    const job = slot.busy;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.busy = null;
    job?.resolve(outcome);
    pump();
  };

  const spawn = (): Slot => {
    const worker = new Worker(workerUrl);
    worker.unref();
    const slot: Slot = { worker, busy: null, timer: null };
    worker.on("message", (message: WorkerResponse) => {
      if (slot.busy?.id === message.id) finish(slot, message.outcome);
    });
    const replace = (detail: string) => {
      const index = slots.indexOf(slot);
      if (index >= 0) slots.splice(index, 1);
      if (slot.busy) finish(slot, { status: "error", detail });
    };
    worker.on("error", (error) => replace(`replay worker crashed: ${error.message}`));
    worker.on("exit", (code) => replace(`replay worker exited (${code})`));
    slots.push(slot);
    return slot;
  };

  function pump(): void {
    if (closed) return;
    while (queue.length > 0) {
      const slot = slots.find((s) => s.busy === null) ?? (slots.length < options.size ? spawn() : undefined);
      if (!slot) return;
      const next = queue.shift();
      if (!next) return;
      slot.busy = next;
      slot.timer = setTimeout(() => {
        // A runaway replay: kill the thread (its exit handler resolves the job as `error`), start fresh next time.
        void slot.worker.terminate();
      }, timeoutMs);
      slot.timer.unref();
      slot.worker.postMessage({ id: next.id, job: next.job } satisfies WorkerRequest);
    }
  }

  return {
    verify(job) {
      if (closed) return Promise.resolve({ status: "error", detail: "verifier closed" });
      return new Promise<ReplayOutcome>((resolve) => {
        queue.push({ id: ++seq, job, resolve });
        pump();
      });
    },
    async close() {
      closed = true;
      for (const p of queue.splice(0)) p.resolve({ status: "error", detail: "verifier closed" });
      await Promise.all(slots.map((s) => s.worker.terminate()));
    },
  };
}
