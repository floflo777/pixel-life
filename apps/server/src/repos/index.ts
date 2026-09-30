import type { Kysely, Transaction } from "kysely";
import type { Database } from "../db/schema.js";
import { createBindingRepo, type BindingRepo } from "./bindings.js";
import { createNonceRepo, type NonceRepo } from "./nonces.js";
import { createSessionRepo, type SessionRepo } from "./sessions.js";

export type { BindingRepo, FriendBinding } from "./bindings.js";
export type { NonceRepo } from "./nonces.js";
export type { SessionRecord, SessionRepo } from "./sessions.js";

/** Either the root Kysely handle or an open transaction: every repo works on both. */
export type Executor = Kysely<Database> | Transaction<Database>;

/**
 * All repositories over one executor. Route handlers depend on this, never on SQL.
 * Feature repos (friends, runs, ledger, inbox, seedpack) are added next to these in T7b.
 */
export interface Repos {
  readonly nonces: NonceRepo;
  readonly sessions: SessionRepo;
  readonly bindings: BindingRepo;
  /** Runs `fn` in one (READ COMMITTED) transaction with repos bound to it; rolls back on throw. */
  transaction<T>(fn: (repos: Repos) => Promise<T>): Promise<T>;
}

/** Builds the repositories over `db` (root handle or transaction). */
export function createRepos(db: Executor): Repos {
  return {
    nonces: createNonceRepo(db),
    sessions: createSessionRepo(db),
    bindings: createBindingRepo(db),
    transaction: (fn) =>
      db.isTransaction
        ? fn(createRepos(db)) // already inside one: nest by reuse, Postgres has no true nested transactions
        : db.transaction().execute((trx) => fn(createRepos(trx))),
  };
}
