import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.js";

/** Single-use SIWE nonces (architecture §1.6: 5 min TTL, single use). */
export interface NonceRepo {
  /** Stores a fresh nonce valid until `expiresAt`. */
  create(nonce: string, now: Date, expiresAt: Date): Promise<void>;
  /** Atomically marks the nonce used if it exists, is unused and unexpired. True only for the one winning caller. */
  consume(nonce: string, now: Date): Promise<boolean>;
  /** Deletes nonces that expired before `before`; returns how many. */
  purgeExpired(before: Date): Promise<number>;
}

/** Postgres implementation of {@link NonceRepo}. */
export function createNonceRepo(db: Kysely<Database> | Transaction<Database>): NonceRepo {
  return {
    async create(nonce, now, expiresAt) {
      await db
        .insertInto("auth_nonces")
        .values({ nonce, created_at: now, expires_at: expiresAt, used_at: null })
        .execute();
    },
    async consume(nonce, now) {
      // One UPDATE with the whole predicate: concurrent replays cannot both see used_at IS NULL.
      const row = await db
        .updateTable("auth_nonces")
        .set({ used_at: now })
        .where("nonce", "=", nonce)
        .where("used_at", "is", null)
        .where("expires_at", ">", now)
        .returning("nonce")
        .executeTakeFirst();
      return row !== undefined;
    },
    async purgeExpired(before) {
      const result = await db.deleteFrom("auth_nonces").where("expires_at", "<", before).executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
