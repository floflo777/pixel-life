import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createChainClient, deploymentFromConfig, type ChainClient } from "./chain/eligibility.js";
import type { ServerConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { createDb, type Db } from "./db/pool.js";
import { createFriendViews } from "./friends/view.js";
import { HttpError, registerErrorHandling } from "./http/errors.js";
import { marketRoutes } from "./market/routes.js";
import { UNGUARDED_PATHS, clientIpFrom, originAllowed, originKeyMatches } from "./http/guards.js";
import { registerMetaRoutes } from "./meta/index.js";
import { createRepos } from "./repos/index.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { createRateLimiters, type BucketSpec, type RateScope } from "./security/rate-limit.js";
import { registerEconomyRoutes } from "./economy/routes.js";
import { registerRunRoutes } from "./runs/routes.js";
import { createRunVerification } from "./runs/verification.js";
import { createReplayPool, type RunVerifier } from "./runs/verifier.js";
import { registerSeedPackRoutes } from "./seedpack/routes.js";
import { serverRoll } from "./seedpack/ledger.js";
import { registerWorldRoutes } from "./routes/world.js";
import { createHubRoomRegistry, createServerHub, type ServerHub } from "./ws/hub-registry.js";
import type { RoomRegistry } from "./ws/rooms.js";
import { attachWebSocket } from "./ws/server.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Client IP for rate limiting (see http/guards.ts clientIpFrom). */
    clientIp: string;
  }
}

/** Optional collaborators; anything omitted is built from the config. Tests inject a DB, chain stub and clock. */
export interface AppDeps {
  readonly db?: Db;
  readonly chain?: ChainClient;
  /** Overrides the hub-backed room registry (tests use the stub). */
  readonly rooms?: RoomRegistry;
  /** The realtime hub (tests inject one to observe `notify` / `mended` / `updateToken`). */
  readonly hub?: ServerHub;
  /** Replay verifier (default: a worker_threads pool of `REPLAY_WORKERS` threads). */
  readonly verifier?: RunVerifier;
  /** Seed Pack roll source (default: server CSPRNG with the SDK's rejection sampling). */
  readonly seedpackDraw?: () => number;
  readonly now?: () => Date;
  readonly rateLimits?: Partial<Record<RateScope, BucketSpec>>;
  /** Receives the built context (tests await background work such as `ctx.runs.idle()`). */
  readonly onContext?: (ctx: AppContext) => void;
  /** Newest migration file name this build ships; readiness requires the DB to be at it. */
  readonly expectedMigration?: string | null;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAINTENANCE_MS = 10 * 60_000;

/**
 * Builds the Fastify app: logging, request ids, origin-key guard, CSRF origin check, error handling, health, auth,
 * game routes (friends, runs, economy, seed pack, sky, daily, inbox, stats, me), the replay pool and the WebSocket
 * layer on the @pl/realtime hub. Does not listen and does not run migrations.
 * A DB created here is closed with the app; an injected one is left to its owner.
 */
export async function buildApp(config: ServerConfig, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          'req.headers["x-pl-origin-key"]',
          'res.headers["set-cookie"]',
        ],
        censor: "[redacted]",
      },
    },
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && REQUEST_ID.test(given) ? given : randomUUID();
    },
    bodyLimit: 64 * 1024,
    // The Worker and nginx sit in front; client IPs come from the guarded x-pl-client-ip header instead.
    trustProxy: false,
    return503OnClosing: true,
  });

  const ownsDb = deps.db === undefined;
  const db =
    deps.db ??
    createDb({
      connectionString: config.databaseUrl,
      max: config.dbPoolMax,
      onIdleError: (error) => app.log.warn({ err: error }, "idle database connection error"),
    });
  const now = deps.now ?? (() => new Date());
  const chain = deps.chain ?? createChainClient(config);
  const friends = createFriendViews({ db: db.kysely, chain, config, now });
  const hub = deps.hub ?? createServerHub(app.log);
  const rooms = deps.rooms ?? createHubRoomRegistry({ hub, friends, log: app.log, rooms: config.rooms });
  const verifier = deps.verifier ?? createReplayPool({ size: config.replayWorkers });
  const ctx: AppContext = {
    config,
    db,
    repos: createRepos(db.kysely),
    friends,
    chain,
    deployment: deploymentFromConfig(config),
    limiters: createRateLimiters(deps.rateLimits, () => now().getTime()),
    rooms,
    now,
    expectedMigration: deps.expectedMigration ?? null,
    hub,
    runs: createRunVerification({ db, verifier, now, log: app.log }),
    seedpackDraw: deps.seedpackDraw ?? serverRoll,
  };

  deps.onContext?.(ctx);
  if (config.originKey === null) app.log.warn("ORIGIN_KEY is not set: origin-key guard disabled (dev/test only)");

  app.decorateRequest("clientIp", "");
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    request.clientIp = clientIpFrom(config, request.headers, request.socket.remoteAddress);
    const path = request.url.split("?", 1)[0] ?? "";
    if (!UNGUARDED_PATHS.has(path) && !originKeyMatches(config, request.headers)) {
      // Deliberately bland: a direct hit on the origin learns nothing about the app.
      throw new HttpError(403, "forbidden", "Forbidden.");
    }
    if (!SAFE_METHODS.has(request.method) && !originAllowed(config, request.headers.origin)) {
      throw new HttpError(403, "forbidden", "Origin not allowed.", { reason: "bad_origin" });
    }
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });

  registerErrorHandling(app);
  registerHealthRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerWorldRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerEconomyRoutes(app, ctx);
  registerSeedPackRoutes(app, ctx);
  await app.register(marketRoutes, { ctx });
  registerMetaRoutes(app, ctx);

  const ws = attachWebSocket(app.server, ctx, app.log);

  let maintenance: NodeJS.Timeout | undefined;
  app.addHook("onReady", async () => {
    maintenance = setInterval(() => {
      const now = ctx.now();
      for (const limiter of Object.values(ctx.limiters)) limiter.sweep();
      void Promise.all([ctx.repos.nonces.purgeExpired(now), ctx.repos.sessions.purgeExpired(now)]).catch(
        (error: unknown) => app.log.warn({ err: error }, "maintenance purge failed"),
      );
    }, MAINTENANCE_MS);
    maintenance.unref();
    // Runs left pending by a restart (or stored before the sim shipped) are replayed in the background.
    void ctx.runs.resumePending().catch((error: unknown) => app.log.warn({ err: error }, "resume pending runs failed"));
  });
  app.addHook("preClose", async () => {
    clearInterval(maintenance);
    await ws.close();
    await ctx.runs.idle();
    await verifier.close();
  });
  app.addHook("onClose", async () => {
    if (ownsDb) await db.destroy();
  });

  return app;
}
