/**
 * e2e launcher for apps/server (a Playwright `webServer`): provides a fresh PostgreSQL database, builds the server
 * bundle exactly as production does, then runs it against the shared mock chain with test secrets, behind a loopback
 * stand-in for the edge Worker (env/edge.ts: origin key + client IP, as in production). Migrations run on start
 * (MIGRATE_ON_START). Everything is torn down on SIGTERM/SIGINT (Playwright's graceful shutdown).
 *
 * Database, in order of preference:
 *  - `E2E_DATABASE_URL`: superuser URL of an existing cluster (CI service container); a `pl_e2e_*` database is created
 *    on it and dropped afterwards;
 *  - otherwise a disposable `postgres:16-alpine` Docker container on a random loopback port.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { startEdge } from "./edge.js";
import {
  API_PORT,
  SERVER_PORT,
  SHARED_RPC_URL,
  STACK_STATE_FILE,
  TEST_SECRETS,
  WEB_URL,
  type StackState,
} from "./stack.js";

const run = promisify(execFile);
const SERVER_DIR = fileURLToPath(new URL("../../../apps/server/", import.meta.url));
const IMAGE = process.env["E2E_PG_IMAGE"] ?? "postgres:16-alpine";
const log = (message: string) => process.stdout.write(`[e2e server] ${message}\n`);

const cleanups: (() => Promise<void>)[] = [];
let child: ChildProcess | null = null;
let stopping = false;

async function waitForPostgres(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      last = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${String(last)}`);
}

/** A superuser URL: the given cluster, or a fresh Docker container (removed on exit). */
async function cluster(): Promise<string> {
  const given = process.env["E2E_DATABASE_URL"];
  if (given) return given;
  const password = randomBytes(12).toString("hex");
  const name = `pl-e2e-pg-${process.pid}`;
  log(`starting ${IMAGE} (${name})`);
  const { stdout } = await run("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--label",
    "pl-e2e=1",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    IMAGE,
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
    "-c",
    "full_page_writes=off",
  ]);
  const id = stdout.trim();
  cleanups.push(async () => {
    await run("docker", ["rm", "-f", id]).catch(() => undefined);
  });
  const { stdout: mapped } = await run("docker", ["port", id, "5432/tcp"]);
  const hostPort = /:(\d+)\s*$/m.exec(mapped.trim())?.[1];
  if (!hostPort) throw new Error(`Cannot read the mapped Postgres port from: ${mapped}`);
  return `postgres://postgres:${password}@127.0.0.1:${hostPort}/postgres`;
}

/** Creates a throwaway database on the cluster and returns its URL (dropped on exit). */
async function freshDatabase(adminUrl: string): Promise<string> {
  await waitForPostgres(adminUrl, 60_000);
  const name = `pl_e2e_${Date.now()}_${randomBytes(3).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  cleanups.push(async () => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.end();
  });
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function shutdown(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 8_000);
        child?.once("exit", () => {
          clearTimeout(timer);
          resolve(null);
        });
      });
    }
    for (const cleanup of cleanups.reverse()) await cleanup().catch((e: unknown) => log(`cleanup: ${String(e)}`));
  }
  process.exit(code);
}

process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

async function main(): Promise<void> {
  const databaseUrl = await freshDatabase(await cluster());
  const state: StackState = { databaseUrl };
  writeFileSync(STACK_STATE_FILE, JSON.stringify(state));
  cleanups.push(async () => rmSync(STACK_STATE_FILE, { force: true }));
  log("building apps/server");
  await run(process.execPath, ["scripts/build.mjs"], { cwd: SERVER_DIR });
  const edge = await startEdge({ port: API_PORT, upstreamPort: SERVER_PORT, originKey: TEST_SECRETS.ORIGIN_KEY });
  cleanups.push(() => edge.close());
  log(`edge :${API_PORT} → server :${SERVER_PORT}, chain ${SHARED_RPC_URL}`);
  child = spawn(process.execPath, ["--enable-source-maps", "dist/main.mjs"], {
    cwd: SERVER_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: String(SERVER_PORT),
      TRUST_EDGE_CLIENT_IP: "true",
      LOG_LEVEL: process.env["E2E_SERVER_LOG_LEVEL"] ?? "warn",
      DATABASE_URL: databaseUrl,
      PUBLIC_ORIGINS: WEB_URL,
      COOKIE_SECURE: "false",
      RPC_URL: SHARED_RPC_URL,
      ECONOMY_MODE: "sim",
      GUEST_MODE: "on",
      REPLAY_WORKERS: "1",
      MIGRATE_ON_START: "true",
      ...TEST_SECRETS,
    },
  });
  child.once("exit", (code) => {
    if (!stopping) {
      log(`server exited with ${String(code)}`);
      void shutdown(code ?? 1);
    }
  });
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  void shutdown(1);
});
