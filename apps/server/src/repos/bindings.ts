import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.js";

/** A session's verified Friend: who owned which token, with which TBA, at which block. */
export interface FriendBinding {
  readonly sid: string;
  readonly tokenId: string;
  readonly address: string;
  readonly tba: string;
  readonly block: number;
  readonly checkedAt: Date;
}

/** friend_bindings: at most one bound Friend per session. */
export interface BindingRepo {
  /** Inserts or replaces the session's binding. */
  upsert(binding: FriendBinding): Promise<void>;
  get(sid: string): Promise<FriendBinding | null>;
  /** Removes the binding (ownership lost, re-pick, logout). */
  delete(sid: string): Promise<void>;
}

/** Postgres implementation of {@link BindingRepo}. */
export function createBindingRepo(db: Kysely<Database> | Transaction<Database>): BindingRepo {
  return {
    async upsert(b) {
      const row = {
        sid: b.sid,
        token_id: b.tokenId,
        address: b.address.toLowerCase(),
        tba: b.tba.toLowerCase(),
        block: b.block,
        checked_at: b.checkedAt,
      };
      await db
        .insertInto("friend_bindings")
        .values(row)
        .onConflict((oc) => oc.column("sid").doUpdateSet(row))
        .execute();
    },
    async get(sid) {
      const row = await db.selectFrom("friend_bindings").selectAll().where("sid", "=", sid).executeTakeFirst();
      if (!row) return null;
      return {
        sid: row.sid,
        tokenId: row.token_id,
        address: row.address,
        tba: row.tba,
        block: row.block,
        checkedAt: row.checked_at,
      };
    },
    async delete(sid) {
      await db.deleteFrom("friend_bindings").where("sid", "=", sid).execute();
    },
  };
}
