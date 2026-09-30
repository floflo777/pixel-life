import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { latestAppliedMigration } from "../db/migrate.js";

const READY_TIMEOUT_MS = 2_000;

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms).unref()),
  ]);

/**
 * Liveness (`/healthz`: the process serves HTTP) and readiness (`/readyz`: Postgres answers and the
 * schema is at the version this build expects). Both skip the origin-key guard and nginx never proxies them.
 */
export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const startedAt = ctx.now();
  app.get("/healthz", { logLevel: "warn" }, async () => ({
    status: "ok",
    uptimeSeconds: Math.round((ctx.now().getTime() - startedAt.getTime()) / 1000),
  }));

  app.get("/readyz", { logLevel: "warn" }, async (request, reply) => {
    try {
      const migration = await withTimeout(latestAppliedMigration(ctx.db.pool), READY_TIMEOUT_MS);
      if (ctx.expectedMigration !== null && migration !== ctx.expectedMigration) {
        return reply.status(503).send({ status: "not_ready", db: "ok", migration, expected: ctx.expectedMigration });
      }
      return { status: "ready", db: "ok", migration };
    } catch (error) {
      request.log.warn({ err: error }, "readiness check failed");
      return reply.status(503).send({ status: "not_ready", db: "down" });
    }
  });
}
