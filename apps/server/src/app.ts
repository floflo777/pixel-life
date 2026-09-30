import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createChainClient, deploymentFromConfig, type ChainClient } from "./chain/eligibility.js";
import type { ServerConfig } from "./config.js";
import type { AppContext } from "./context.js";
import { createDb, type Db } from "./db/pool.js";
import { createFriendViews } from "./friends/view.js";
import { HttpError, registerErrorHandling } from "./http/errors.js";
import { UNGUARDED_PATHS, clientIpFrom, originAllowed, originKeyMatches } from "./http/guards.js";
import { registerMetaRoutes } from "./meta/index.js";
import { createRepos } from "./repos/index.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerHealthRoutes } from "./routes/health.js";
import { createRateLimiters, type BucketSpec, type RateScope } from "./security/rate-limit.js";
import { createStubRoomRegistry, type RoomRegistry } from "./ws/rooms.js";
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
  readonly rooms?: RoomRegistry;
  readonly now?: () => Date;
  readonly rateLimits?: Partial<Record<RateScope, BucketSpec>>;
  /** Newest migration file name this build ships; readiness requires the DB to be at it. */
  readonly expectedMigration?: string | null;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAINTENANCE_MS = 10 * 60_000;

/**
 * Builds the Fastify app: logging, request ids, origin-key guard, CSRF origin check, error handling,
 * health, auth routes and the WebSocket upgrade layer. Does not listen and does not run migrations.
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
  const rooms = deps.rooms ?? createStubRoomRegistry(config.rooms);
  const now = deps.now ?? (() => new Date());
  const chain = deps.chain ?? createChainClient(config);
  const ctx: AppContext = {
    config,
    db,
    repos: createRepos(db.kysely),
    friends: createFriendViews({ db: db.kysely, chain, config, now }),
    chain,
    deployment: deploymentFromConfig(config),
    limiters: createRateLimiters(deps.rateLimits, () => now().getTime()),
    rooms,
    now,
    expectedMigration: deps.expectedMigration ?? null,
  };

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
  });
  app.addHook("preClose", async () => {
    clearInterval(maintenance);
    await ws.close();
  });
  app.addHook("onClose", async () => {
    if (ownsDb) await db.destroy();
  });

  return app;
}
