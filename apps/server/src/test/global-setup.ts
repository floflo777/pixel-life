import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import type { TestProject } from "vitest/node";

const run = promisify(execFile);
const IMAGE = process.env["TEST_PG_IMAGE"] ?? "postgres:16-alpine";

declare module "vitest" {
  export interface ProvidedContext {
    /** Superuser URL of the test cluster; test files create their own databases on it. */
    pgAdminUrl: string;
  }
}

async function waitForPostgres(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch (error) {
      lastError = error;
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${String(lastError)}`);
}

/**
 * Real PostgreSQL for server tests. Uses TEST_DATABASE_URL when set (CI service container or a local
 * cluster); otherwise starts a disposable `postgres:16-alpine` container on a random loopback port and
 * removes it afterwards. Durability is switched off: this data is thrown away.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env["TEST_DATABASE_URL"];
  if (external) {
    await waitForPostgres(external, 30_000);
    project.provide("pgAdminUrl", external);
    return async () => undefined;
  }
  const name = `pl-server-test-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  try {
    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-p",
      "127.0.0.1::5432",
      "--tmpfs",
      "/var/lib/postgresql/data",
      IMAGE,
      "-c",
      "fsync=off",
      "-c",
      "synchronous_commit=off",
      "-c",
      "full_page_writes=off",
    ]);
  } catch (error) {
    throw new Error(
      `Server tests need PostgreSQL: start Docker or set TEST_DATABASE_URL (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  const stop = async () => {
    await run("docker", ["rm", "-f", name]).catch(() => undefined);
  };
  try {
    const { stdout } = await run("docker", ["port", name, "5432/tcp"]);
    const hostPort = stdout.trim().split("\n")[0]?.trim();
    if (!hostPort) throw new Error("docker port returned nothing");
    const url = `postgres://postgres:${password}@${hostPort}/postgres`;
    await waitForPostgres(url, 60_000);
    project.provide("pgAdminUrl", url);
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
