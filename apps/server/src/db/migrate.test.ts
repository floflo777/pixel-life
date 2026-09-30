import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, createTestDatabase } from "../test/harness.js";
import { latestAppliedMigration, loadMigrations, migrate } from "./migrate.js";
import type { Db } from "./pool.js";

let db: Db;
let drop: () => Promise<void>;
beforeEach(async () => {
  ({ db, drop } = await createTestDatabase());
});
afterEach(async () => {
  await drop();
});

const ZERO = "0".repeat(64);
const TX = `0x${"ab".repeat(32)}`;

describe("migration runner", () => {
  it("is idempotent and records what it applied", async () => {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    expect(migrations.map((m) => m.name)).toContain("0001_init.sql");
    const again = await migrate(db.pool, migrations);
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toEqual(migrations.map((m) => m.name));
    expect(await latestAppliedMigration(db.pool)).toBe(migrations.at(-1)?.name);
  });

  it("refuses to run when an applied migration was edited", async () => {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    const tampered = migrations.map((m) => ({ ...m, checksum: "0".repeat(64) }));
    await expect(migrate(db.pool, tampered)).rejects.toThrow(/was modified after being applied/);
  });

  it("rolls back a failing migration and leaves no record of it", async () => {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    const broken = { name: "9999_broken.sql", sql: "CREATE TABLE ok_part (x int); SELECT nope();", checksum: "x" };
    await expect(migrate(db.pool, [...migrations, broken])).rejects.toThrow(/9999_broken.sql failed/);
    const exists = await db.pool.query("SELECT to_regclass('ok_part') AS t");
    expect(exists.rows[0].t).toBeNull();
    expect(await latestAppliedMigration(db.pool)).toBe(migrations.at(-1)?.name);
  });
});

describe("schema constraints (architecture §4.2 on Postgres)", () => {
  const ledger = (over: Record<string, unknown>) =>
    db.kysely
      .insertInto("rf_ledger")
      .values({
        id: `l${Math.random().toString(36).slice(2)}`,
        kind: "mend",
        mode: "live",
        payer_token: "1",
        target_token: "2",
        pixels: 3,
        total: "300",
        burn: "150",
        stream: "0",
        to_target: "150",
        tx_hash: TX,
        log_index: 0,
        block: 10,
        created_at: new Date(),
        ...over,
      })
      .execute();

  it("keys live ledger rows on (tx_hash, log_index): one tx may emit several events, never twice the same", async () => {
    await ledger({ log_index: 0 });
    await ledger({ log_index: 1 });
    await expect(ledger({ log_index: 1 })).rejects.toThrow(/rf_ledger_tx_hash_log_index_key/);
  });

  it("enforces burn + stream + to_target = total and live/sim coordinates", async () => {
    await expect(ledger({ total: "301" })).rejects.toThrow(/check/);
    await expect(ledger({ mode: "sim" })).rejects.toThrow(/check/);
    await ledger({ mode: "sim", tx_hash: null, log_index: null, block: null });
  });

  it("rejects out-of-range token ids, bad addresses and negative balances", async () => {
    const now = new Date();
    const friend = (over: Record<string, unknown>) =>
      db.kysely
        .insertInto("friends")
        .values({
          token_id: "344030",
          family_id: 1,
          seed: 7,
          tba: null,
          last_owner: null,
          scar_updated_at: now,
          streak_day: null,
          sim_granted_day: null,
          last_seen: now,
          created_at: now,
          ...over,
        })
        .execute();
    await expect(friend({ token_id: "0" })).rejects.toThrow(/token_id_check/);
    await expect(friend({ token_id: (1n << 256n).toString() })).rejects.toThrow();
    await expect(friend({ last_owner: "0xABC" })).rejects.toThrow(/eth_address_check/);
    await expect(friend({ sim_rf_micro: -1 })).rejects.toThrow(/check/);
    await expect(friend({ lost: "zz" })).rejects.toThrow(/hex64_check/);
    await friend({ token_id: (1n << 255n).toString(), sim_rf_micro: 2 ** 52, streak_day: "2026-10-01" });
    const row = await db.kysely.selectFrom("friends").selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      token_id: (1n << 255n).toString(),
      sim_rf_micro: 2 ** 52,
      lost: ZERO,
      streak_day: "2026-10-01",
    });
  });

  it("keeps runs attributed to exactly one of token or guest, and daily runs dated", async () => {
    const run = (over: Record<string, unknown>) =>
      db.kysely
        .insertInto("runs")
        .values({
          id: `r${Math.random().toString(36).slice(2)}`,
          token_id: "5",
          guest_id: null,
          kind: "free",
          day: null,
          seed: 1,
          inputs: Buffer.from([1, 2]),
          score: 10,
          lost_delta: ZERO,
          final_hash: "h",
          created_at: new Date(),
          ...over,
        })
        .execute();
    await run({});
    await expect(run({ guest_id: "g_x" })).rejects.toThrow(/check/);
    await expect(run({ token_id: null })).rejects.toThrow(/check/);
    await expect(run({ kind: "daily" })).rejects.toThrow(/check/);
    await run({ kind: "daily", day: "2026-10-01" });
  });

  it("stores jsonb inventories and refuses non-arrays", async () => {
    await db.kysely
      .insertInto("seedpack_friend")
      .values({ token_id: "9", inventory: JSON.stringify([0, 0, 0, 2]) })
      .execute();
    const row = await db.kysely.selectFrom("seedpack_friend").selectAll().executeTakeFirstOrThrow();
    expect(row.inventory).toEqual([0, 0, 0, 2]);
    await expect(
      db.kysely
        .insertInto("seedpack_friend")
        .values({ token_id: "10", inventory: JSON.stringify({ a: 1 }) })
        .execute(),
    ).rejects.toThrow(/check/);
    await expect(sql`INSERT INTO seedpack_house VALUES (2, 0, 0, 0)`.execute(db.kysely)).rejects.toThrow(/check/);
  });
});
