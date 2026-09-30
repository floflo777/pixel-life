import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

/** One SQL migration file. */
export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

/** Outcome of {@link migrate}. */
export interface MigrateResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
/** Arbitrary constant: serialises concurrent runners (e.g. two containers starting at once). */
const ADVISORY_LOCK_KEY = 7_470_411;

/**
 * Locates `apps/server/migrations`: next to `src/` when running from source, next to `dist/` when bundled.
 * `MIGRATIONS_DIR` overrides both.
 */
export function defaultMigrationsDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const override = env["MIGRATIONS_DIR"];
  if (override) return path.resolve(override);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, "../../migrations"), path.resolve(here, "../migrations")];
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) throw new Error(`No migrations directory found (looked in ${candidates.join(", ")}).`);
  return found;
}

/** Reads `NNNN_name.sql` files in lexical order. Other files are ignored. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(path.join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    }),
  );
}

/**
 * Applies pending migrations, each in its own transaction, under a session advisory lock.
 * Refuses to run if an applied migration's file changed (checksum mismatch): applied SQL is immutable.
 */
export async function migrate(pool: pg.Pool, migrations: readonly Migration[]): Promise<MigrateResult> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations ORDER BY name",
    );
    const known = new Map(rows.map((r) => [r.name, r.checksum]));
    const names = new Set(migrations.map((m) => m.name));
    for (const name of known.keys()) {
      if (!names.has(name)) throw new Error(`Migration ${name} is applied but missing from disk.`);
    }
    const applied: string[] = [];
    const alreadyApplied: string[] = [];
    for (const migration of migrations) {
      const checksum = known.get(migration.name);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new Error(`Migration ${migration.name} was modified after being applied; add a new migration instead.`);
        }
        alreadyApplied.push(migration.name);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          migration.name,
          migration.checksum,
        ]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        );
      }
      applied.push(migration.name);
    }
    return { applied, alreadyApplied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/** Name of the newest applied migration, or null (readiness compares it to the newest file on disk). */
export async function latestAppliedMigration(pool: pg.Pool): Promise<string | null> {
  const exists = await pool.query<{ ok: boolean }>("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok");
  if (!exists.rows[0]?.ok) return null;
  const { rows } = await pool.query<{ name: string | null }>("SELECT max(name) AS name FROM schema_migrations");
  return rows[0]?.name ?? null;
}
