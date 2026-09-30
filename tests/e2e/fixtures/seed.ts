/**
 * Direct database seeding for states the UI cannot reach quickly. Used sparingly: only for history that would take
 * minutes of real play (the server rate-limits runs to one per 40 s per Friend). Local stack only.
 */
import { readFileSync } from "node:fs";
import { EMPTY_MASK, frontMask, getBit, popcount, setBit, type FriendAppearance, type Hex64 } from "@pl/shared";
import pg from "pg";
import { STACK_STATE_FILE, type StackState } from "../env/stack.js";

/** Runs a Friend needs before its scars persist (apps/server `NEWBIE_RUNS`). */
export const NEWBIE_RUNS = 3;

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const state = JSON.parse(readFileSync(STACK_STATE_FILE, "utf8")) as StackState;
  const client = new pg.Client({ connectionString: state.databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Gives `tokenId` {@link NEWBIE_RUNS} past verified, scarless free runs (dated yesterday), so its next run is no longer
 * a newbie run and its scars stick.
 */
export async function seedPastRuns(tokenId: string, count = NEWBIE_RUNS): Promise<void> {
  await withDb(async (db) => {
    for (let i = 0; i < count; i++) {
      await db.query(
        `INSERT INTO runs (id, token_id, kind, seed, inputs, score, lost_delta, final_hash, verified, created_at)
         VALUES ($1, $2, 'free', $3, $4, 0, $5, 'e2e-seed', 1, now() - interval '1 day')`,
        [`e2e_${tokenId}_${i}_${Date.now()}`, tokenId, i + 1, Buffer.alloc(0), "0".repeat(64)],
      );
    }
  });
}

/**
 * Knocks `count` front pixels off a Friend the server already knows (bound at least once), as if a verified run had
 * just scarred it. Returns the new scar mask. Lets Regrow/Mend specs start from a scarred Friend without a 60 s run.
 */
export async function seedScars(baseUrl: string, tokenId: string, count: number): Promise<Hex64> {
  const res = await fetch(new URL(`/api/friends/${tokenId}/appearance`, baseUrl));
  if (!res.ok) throw new Error(`appearance of #${tokenId}: HTTP ${res.status}`);
  const front = frontMask((await res.json()) as FriendAppearance);
  let lost: Hex64 = EMPTY_MASK;
  for (let i = 0, n = 0; i < 256 && n < count; i++)
    if (getBit(front, i)) {
      lost = setBit(lost, i, true);
      n++;
    }
  if (popcount(lost) !== count) throw new Error(`#${tokenId} has fewer than ${count} front pixels`);
  await withDb(async (db) => {
    const updated = await db.query(
      `UPDATE friends SET lost = $2, scar_version = scar_version + 1, scar_updated_at = now() WHERE token_id = $1`,
      [tokenId, lost],
    );
    if (updated.rowCount !== 1) throw new Error(`#${tokenId} is not known to the server yet (bind it first)`);
  });
  return lost;
}

/** Puts `count` Gold Pixels (Seed Pack outcome 4) in a Friend's inventory, as a lucky pack would (2 % odds). */
export async function seedGold(tokenId: string, count = 1): Promise<void> {
  const inventory = JSON.stringify([0, 0, 0, 0, count]);
  await withDb(async (db) => {
    await db.query(
      `INSERT INTO seedpack_friend (token_id, inventory) VALUES ($1, $2::jsonb)
       ON CONFLICT (token_id) DO UPDATE SET inventory = EXCLUDED.inventory`,
      [tokenId, inventory],
    );
  });
}
