/** @pl/server — public entry point: the app factory and the seams T7b (endpoints) and T8 (rooms) build on. */
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
