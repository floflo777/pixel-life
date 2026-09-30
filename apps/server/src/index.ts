/** @pl/server — public entry point: the app factory, its seams, and the game modules other tools may reuse. */
export { buildApp, type AppDeps } from "./app.js";
export { loadConfig, ConfigError, siweDomains, type ServerConfig } from "./config.js";
export type { AppContext } from "./context.js";
export { createDb, type Db } from "./db/pool.js";
export type { Database } from "./db/schema.js";
export { migrate, loadMigrations, defaultMigrationsDir } from "./db/migrate.js";
export { createRepos, type Repos, type Executor } from "./repos/index.js";
export { HttpError, validated, type ErrorBody, type ErrorReason } from "./http/errors.js";
export { enforceRateLimit } from "./http/guards.js";
export { requireSession, readSession, readGuest, type OwnerSession, type GuestIdentity } from "./auth/session.js";
export { bindFriend, requireBinding, RUN_RECHECK_MS } from "./auth/binding.js";
export { checkFriendEligibility, type ChainClient } from "./chain/eligibility.js";
export { createFriendViews, type FriendViews } from "./friends/view.js";
export { createRateLimiter, DEFAULT_LIMITS, type RateLimiter, type RateScope } from "./security/rate-limit.js";
export {
  CLOSE_CODES,
  createStubRoomRegistry,
  type RoomConnection,
  type RoomRegistry,
  type SocketIdentity,
} from "./ws/rooms.js";
export { createHubRoomRegistry, createServerHub, DEFAULT_LOANER, type ServerHub } from "./ws/hub-registry.js";
export { createReplayPool, disabledVerifier, type RunVerifier, type ReplayPoolOptions } from "./runs/verifier.js";
export type { ReplayJob, ReplayOutcome } from "./runs/replay-protocol.js";
export { createRunVerification, type RunVerification } from "./runs/verification.js";
export * as SeedPackLedger from "./seedpack/ledger.js";
export { dailySeed, utcDay, nextStreak, currentStreak } from "./game/daily.js";
export { decodeSinkPayments, paymentMatches, SINK_EVENTS_ABI, type SinkPayment } from "./economy/live.js";
