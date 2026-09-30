import type { Kysely, Selectable, Transaction } from "kysely";
import type { Database, SessionsTable } from "../db/schema.js";

/** A stored owner session. */
export type SessionRecord = Selectable<SessionsTable>;

/** Owner sessions: the JWT carries `sid`; this table is the revocation source of truth. */
export interface SessionRepo {
  create(session: { sid: string; address: string; createdAt: Date; expiresAt: Date }): Promise<void>;
  /** The session if it exists, is not revoked and not expired at `now`. */
  findActive(sid: string, now: Date): Promise<SessionRecord | null>;
  /** Revokes one session (idempotent). Its friend binding is deleted with it. */
  revoke(sid: string, now: Date): Promise<void>;
  /** Revokes every active session of an address (e.g. "log out everywhere"); returns how many. */
  revokeAllForAddress(address: string, now: Date): Promise<number>;
  /** Deletes sessions expired before `before`; returns how many. */
  purgeExpired(before: Date): Promise<number>;
}

/** Postgres implementation of {@link SessionRepo}. */
export function createSessionRepo(db: Kysely<Database> | Transaction<Database>): SessionRepo {
  return {
    async create({ sid, address, createdAt, expiresAt }) {
      await db
        .insertInto("sessions")
        .values({ sid, address: address.toLowerCase(), created_at: createdAt, expires_at: expiresAt, revoked_at: null })
        .execute();
    },
    async findActive(sid, now) {
      const row = await db
        .selectFrom("sessions")
        .selectAll()
        .where("sid", "=", sid)
        .where("revoked_at", "is", null)
        .where("expires_at", ">", now)
        .executeTakeFirst();
      return row ?? null;
    },
    async revoke(sid, now) {
      await db.deleteFrom("friend_bindings").where("sid", "=", sid).execute();
      await db
        .updateTable("sessions")
        .set({ revoked_at: now })
        .where("sid", "=", sid)
        .where("revoked_at", "is", null)
        .execute();
    },
    async revokeAllForAddress(address, now) {
      const lower = address.toLowerCase();
      await db
        .deleteFrom("friend_bindings")
        .where("sid", "in", db.selectFrom("sessions").select("sid").where("address", "=", lower))
        .execute();
      const result = await db
        .updateTable("sessions")
        .set({ revoked_at: now })
        .where("address", "=", lower)
        .where("revoked_at", "is", null)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    },
    async purgeExpired(before) {
      const result = await db.deleteFrom("sessions").where("expires_at", "<", before).executeTakeFirst();
      return Number(result.numDeletedRows);
    },
  };
}
