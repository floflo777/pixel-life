import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema.js";

const INT8_OID = 20;
const DATE_OID = 1082;

/** int8 → JS number, refusing values a number cannot hold exactly (micro-RF is designed to stay below 2^53). */
function parseInt8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`int8 value ${value} exceeds the JS safe integer range`);
  return n;
}

/** Per-pool type parsers (never mutates pg's global parsers). */
const types = {
  getTypeParser(oid: number, format?: "text" | "binary") {
    if (oid === INT8_OID) return parseInt8;
    // Calendar days stay "YYYY-MM-DD": a Date would silently shift with the process timezone.
    if (oid === DATE_OID) return (value: string) => value;
    return format === "binary" ? pg.types.getTypeParser(oid, "binary") : pg.types.getTypeParser(oid, "text");
  },
};

/** Options for {@link createDb}. */
export interface DbOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly applicationName?: string;
  /** Called when an idle pooled connection errors (e.g. Postgres restarted). Without a handler pg would crash the process. */
  readonly onIdleError?: (error: Error) => void;
}

/** A Kysely instance plus the pg pool behind it (the migration runner and health checks use the pool). */
export interface Db {
  readonly kysely: Kysely<Database>;
  readonly pool: pg.Pool;
  /** Closes the pool; idempotent. */
  destroy(): Promise<void>;
}

/** Creates the pool and Kysely instance. Connections are lazy: nothing touches the network until the first query. */
export function createDb(options: DbOptions): Db {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "pixel-life",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // A runaway query must not hold a connection forever.
    statement_timeout: 10_000,
    types,
  });
  pool.on("error", (error) => options.onIdleError?.(error));
  const kysely = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  let destroyed = false;
  return {
    kysely,
    pool,
    async destroy() {
      if (destroyed) return;
      destroyed = true;
      // Kysely only ends the pool if it ever ran a query; the migration runner may have used the pool directly.
      await kysely.destroy();
      if (!pool.ended && !pool.ending) await pool.end();
    },
  };
}
