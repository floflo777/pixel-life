import type { GenerationDeployment } from "@rarefriends/friendsdk/identity";
import type { ChainClient } from "./chain/eligibility.js";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db/pool.js";
import type { FriendViews } from "./friends/view.js";
import type { Repos } from "./repos/index.js";
import type { RateLimiters } from "./security/rate-limit.js";
import type { RunVerification } from "./runs/verification.js";
import type { ServerHub } from "./ws/hub-registry.js";
import type { RoomRegistry } from "./ws/rooms.js";

/** Everything a route or the WebSocket layer needs, built once by buildApp and passed explicitly (no globals). */
export interface AppContext {
  readonly config: ServerConfig;
  readonly db: Db;
  readonly repos: Repos;
  readonly friends: FriendViews;
  readonly chain: ChainClient;
  readonly deployment: GenerationDeployment;
  readonly limiters: RateLimiters;
  readonly rooms: RoomRegistry;
  /** Wall clock; injectable so tests can expire nonces and sessions deterministically. */
  readonly now: () => Date;
  /** Newest migration file name the code expects, for readiness. */
  readonly expectedMigration: string | null;
  /** In-process realtime hub: routes call `notify` / `mended` / `updateToken` after their DB commits. */
  readonly hub: ServerHub;
  /** Background replay verification of stored runs. */
  readonly runs: RunVerification;
  /** Seed Pack roll source (uniform 0..9999): the server CSPRNG, injectable for parity tests. */
  readonly seedpackDraw: () => number;
}
