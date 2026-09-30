import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { designWorld, startMockRpc, type MockRpcServer, type WorldSpec } from "@pl/mock-rpc";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { createPublicClient, http, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { inject } from "vitest";
import { buildApp, type AppDeps } from "../app.js";
import type { ChainClient } from "../chain/eligibility.js";
import { loadConfig, type ServerConfig } from "../config.js";
import type { AppContext } from "../context.js";
import { loadMigrations, migrate } from "../db/migrate.js";
import { createDb, type Db } from "../db/pool.js";
import { disabledVerifier } from "../runs/verifier.js";

/** Test-only helpers: real Postgres database per file, @pl/mock-rpc chain, controllable clock, SIWE sign-in. */

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
export const ORIGIN = "https://pixel-life.test.workers.dev";
export const ORIGIN_KEY = "k".repeat(40);
/** Newest migration file this build ships (readiness tests). */
export const LATEST_MIGRATION = "0002_game.sql";

/** A fresh, migrated database on the shared test cluster. `drop()` removes it. */
export async function createTestDatabase(): Promise<{ db: Db; url: string; drop: () => Promise<void> }> {
  const admin = inject("pgAdminUrl");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const adminClient = new pg.Client({ connectionString: admin });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE ${name}`);
  await adminClient.end();
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const db = createDb({ connectionString: url.toString(), max: 5 });
  await migrate(db.pool, await loadMigrations(MIGRATIONS_DIR));
  return {
    db,
    url: url.toString(),
    drop: async () => {
      await db.destroy();
      const c = new pg.Client({ connectionString: admin });
      await c.connect();
      try {
        // No FORCE: terminating backends of clients that are mid-close surfaces as uncaught pg errors.
        for (let attempt = 0; ; attempt++) {
          try {
            await c.query(`DROP DATABASE IF EXISTS ${name}`);
            break;
          } catch (error) {
            if (attempt >= 50) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } finally {
        await c.end();
      }
    },
  };
}

/** Config for tests: production-like guards on (origin key, secure cookies), quiet logs. */
export function testConfig(env: Record<string, string> = {}): ServerConfig {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://unused/unused",
    PUBLIC_ORIGINS: ORIGIN,
    ORIGIN_KEY,
    SESSION_SECRET: "s".repeat(40),
    DAILY_SECRET: "d".repeat(40),
    ...env,
  });
}

/** Mutable wall clock for tests. */
export interface TestClock {
  now(): Date;
  advance(ms: number): void;
}

export function createClock(start = Date.parse("2026-10-01T12:00:00Z")): TestClock {
  let t = start;
  return { now: () => new Date(t), advance: (ms) => void (t += ms) };
}

/** A running app wired to a real DB and the mock chain. */
export interface Harness {
  readonly app: FastifyInstance;
  readonly config: ServerConfig;
  readonly db: Db;
  readonly rpc: MockRpcServer;
  readonly clock: TestClock;
  /** The app's context (background work, hub, config). */
  readonly ctx: AppContext;
  /** Headers every request through the Worker carries. */
  readonly edge: Record<string, string>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  readonly world?: WorldSpec;
  readonly env?: Record<string, string>;
  readonly deps?: Omit<AppDeps, "db" | "now" | "onContext">;
  /** Wrap the real mock-chain client (e.g. to stub EIP-1271 verification). */
  readonly wrapChain?: (client: ChainClient) => ChainClient;
}

/** Starts mock RPC + database + app. Always `close()` it (afterEach). */
export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const rpc = await startMockRpc({ world: options.world ?? designWorld({ owners: {} }) });
  const database = await createTestDatabase();
  const clock = createClock();
  const config = testConfig(options.env);
  const base: ChainClient = createPublicClient({ transport: http(rpc.url, { retryCount: 0 }) });
  let ctx: AppContext | undefined;
  const app = await buildApp(config, {
    // Replay workers are opt-in per test (they spawn threads); everything else uses production defaults.
    verifier: disabledVerifier,
    ...options.deps,
    db: database.db,
    chain: options.wrapChain ? options.wrapChain(base) : base,
    now: clock.now,
    onContext: (c) => void (ctx = c),
  });
  await app.ready();
  if (!ctx) throw new Error("buildApp did not report its context");
  return {
    app,
    config,
    db: database.db,
    rpc,
    clock,
    ctx,
    edge: { "x-pl-origin-key": ORIGIN_KEY, origin: ORIGIN },
    async close() {
      await app.close();
      await database.drop();
      await rpc.close();
    },
  };
}

/** A random wallet (never funded). */
export const newWallet = (): PrivateKeyAccount => privateKeyToAccount(generatePrivateKey());

/** Extracts `name=value` from a response's Set-Cookie headers, for the next request's Cookie header. */
export function cookieFrom(response: LightMyRequestResponse, name: string): string {
  const header = response.headers["set-cookie"];
  const all = Array.isArray(header) ? header : header ? [header] : [];
  const found = all.find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`No ${name} cookie in response`);
  return found.split(";", 1)[0] ?? "";
}

/** Overrides for the SIWE message the helper signs. */
export interface SiweOverrides {
  readonly domain?: string;
  readonly uri?: string;
  readonly chainId?: number;
  readonly issuedAt?: Date;
  readonly expirationTime?: Date;
  readonly nonce?: string;
  readonly address?: Address;
}

/** Fetches a nonce and builds + signs a SIWE message as the web client would (§1.6 step 2). */
export async function signedSiwe(
  h: Harness,
  wallet: PrivateKeyAccount,
  overrides: SiweOverrides = {},
): Promise<{ message: string; signature: string; nonce: string }> {
  const nonceResponse = await h.app.inject({ method: "GET", url: "/api/auth/nonce", headers: h.edge });
  const nonce = overrides.nonce ?? (nonceResponse.json() as { nonce: string }).nonce;
  const issuedAt = overrides.issuedAt ?? h.clock.now();
  const message = createSiweMessage({
    address: overrides.address ?? wallet.address,
    chainId: overrides.chainId ?? 4663,
    domain: overrides.domain ?? new URL(ORIGIN).host,
    uri: overrides.uri ?? ORIGIN,
    nonce,
    version: "1",
    statement: "Sign in to Pixel Life. No transaction, no cost.",
    issuedAt,
    expirationTime: overrides.expirationTime ?? new Date(issuedAt.getTime() + 10 * 60_000),
  });
  const signature = await wallet.signMessage({ message });
  return { message, signature, nonce };
}

/** Full sign-in; returns the `pl_sess=...` cookie pair. */
export async function signIn(h: Harness, wallet: PrivateKeyAccount): Promise<string> {
  const { message, signature } = await signedSiwe(h, wallet);
  const response = await h.app.inject({
    method: "POST",
    url: "/api/auth/verify",
    headers: h.edge,
    payload: { message, signature },
  });
  if (response.statusCode !== 200) throw new Error(`sign-in failed: ${response.statusCode} ${response.body}`);
  return cookieFrom(response, "pl_sess");
}
