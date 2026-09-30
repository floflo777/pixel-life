import type { RunSummary, SimConfig } from "@pl/shared";
import { sql } from "kysely";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/pool.js";
import type { ReplayOutcome } from "./replay-protocol.js";
import type { RunVerifier } from "./verifier.js";

/** Background replay verification of stored runs (architecture §4.6) and its effect on runs and boards. */
export interface RunVerification {
  /** Queues a stored run for replay; returns immediately. */
  enqueue(runId: string): void;
  /** Re-queues runs left pending (e.g. by a restart, or before the sim shipped). Returns how many. */
  resumePending(limit?: number): Promise<number>;
  /** Resolves once every queued verification has been recorded (tests, graceful shutdown). */
  idle(): Promise<void>;
}

type StoredRun = {
  id: string;
  kind: "free" | "daily";
  seed: number;
  arena: string;
  inputs: Buffer;
  score: number;
  lost_delta: string;
  final_hash: string;
  sim_friend: unknown;
};

function jobOf(run: StoredRun): { config: SimConfig; claimed: RunSummary } | null {
  const f = run.sim_friend as SimConfig["friend"] | null;
  if (!f || typeof f !== "object") return null;
  return {
    config: { seed: run.seed, kind: run.kind, arena: run.arena, friend: f },
    // Only the fields a replay must reproduce are stored; the rest never affect `sameSummary`.
    claimed: {
      score: run.score,
      lostDelta: run.lost_delta,
      finalHash: run.final_hash,
      recovered: 0,
      smashed: 0,
      ticks: 0,
    },
  };
}

/** Wires a verifier to the database: `ok` → verified 1; `mismatch` → verified −1 and off the daily board. */
export function createRunVerification(deps: {
  readonly db: Db;
  readonly verifier: RunVerifier;
  readonly now: () => Date;
  readonly log: FastifyBaseLogger;
}): RunVerification {
  const inflight = new Set<Promise<void>>();

  const record = async (
    run: StoredRun & { day: string | null; token_id: string | null; guest_id: string | null },
    outcome: ReplayOutcome,
  ) => {
    const db = deps.db.kysely;
    if (outcome.status === "ok") {
      await db
        .updateTable("runs")
        .set({ verified: 1, verified_at: deps.now(), replay_hash: outcome.summary.finalHash })
        .where("id", "=", run.id)
        .where("verified", "=", 0)
        .execute();
      return;
    }
    if (outcome.status !== "mismatch") {
      if (outcome.status === "error")
        deps.log.warn({ runId: run.id, detail: outcome.detail }, "replay failed; run stays pending");
      return;
    }
    deps.log.warn({ runId: run.id, kind: run.kind, detail: outcome.detail }, "replay mismatch");
    await db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable("runs")
        .set({ verified: -1, verified_at: deps.now(), replay_hash: outcome.summary?.finalHash ?? null })
        .where("id", "=", run.id)
        .where("verified", "=", 0)
        .executeTakeFirst();
      if (updated.numUpdatedRows !== 1n || run.day === null) return;
      const removed = await trx.deleteFrom("daily_best").where("run_id", "=", run.id).returningAll().executeTakeFirst();
      if (!removed) return;
      // The entrant keeps its best remaining (not rejected) run of the day, if any.
      await sql`
        INSERT INTO daily_best (day, board, entrant, score, run_id)
        SELECT day, ${removed.board}, ${removed.entrant}, score, id FROM runs
        WHERE day = ${removed.day} AND kind = 'daily' AND verified >= 0
          AND ${removed.board === "owners" ? sql`token_id = ${removed.entrant}` : sql`guest_id = ${removed.entrant}`}
        ORDER BY score DESC, created_at ASC LIMIT 1
        ON CONFLICT DO NOTHING`.execute(trx);
    });
  };

  const verifyOne = async (runId: string) => {
    const run = await deps.db.kysely
      .selectFrom("runs")
      .select([
        "id",
        "kind",
        "seed",
        "arena",
        "inputs",
        "score",
        "lost_delta",
        "final_hash",
        "sim_friend",
        "day",
        "token_id",
        "guest_id",
        "verified",
      ])
      .where("id", "=", runId)
      .executeTakeFirst();
    if (!run || run.verified !== 0) return;
    const job = jobOf(run);
    if (!job) return;
    const outcome = await deps.verifier.verify({ ...job, inputs: run.inputs.toString("base64") });
    await record(run, outcome);
  };

  const track = (p: Promise<void>) => {
    inflight.add(p);
    void p.finally(() => inflight.delete(p));
  };

  return {
    enqueue(runId) {
      track(
        verifyOne(runId).catch((error: unknown) => deps.log.error({ err: error, runId }, "run verification failed")),
      );
    },
    async resumePending(limit = 500) {
      const rows = await deps.db.kysely
        .selectFrom("runs")
        .select("id")
        .where("verified", "=", 0)
        .where("sim_friend", "is not", null)
        .orderBy("created_at")
        .limit(limit)
        .execute();
      for (const r of rows) this.enqueue(r.id);
      return rows.length;
    },
    async idle() {
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
  };
}
