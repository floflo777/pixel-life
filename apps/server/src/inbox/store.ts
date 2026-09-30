import { randomBytes } from "node:crypto";
import { ECON, type InboxItem, type TokenIdStr } from "@pl/shared";
import { sql, type Selectable } from "kysely";
import type { InboxTable, Json } from "../db/schema.js";
import type { Executor } from "../repos/index.js";

/** Stored payload of an inbox row: the item without the columns it is keyed by. */
type Payload = Record<string, Json>;

const RESERVED = new Set(["id", "tokenId", "createdAt", "readAt", "kind"]);

/** Rebuilds the shared `InboxItem` from a row. Rows of unknown kinds are skipped by callers (null). */
export function itemFromRow(row: Selectable<InboxTable>): InboxItem | null {
  const payload = row.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return {
    ...(payload as Payload),
    id: row.id,
    tokenId: row.token_id,
    kind: row.kind,
    createdAt: row.created_at.getTime(),
    readAt: row.read_at ? row.read_at.getTime() : null,
  } as InboxItem;
}

const dayStart = (today: string) => new Date(`${today}T00:00:00Z`);

/**
 * Records a Mend notification for the target (architecture §4.7). The first `ECON.mendNotifyDailyCap` Mends a Friend
 * receives per UTC day get their own item (returned, to push live); later ones are batched into the day's newest item
 * (`batched + 1`, GDD §5.3 "+12 more menders today") and return null (no push).
 */
export async function recordMendNotice(
  db: Executor,
  target: TokenIdStr,
  fields: Omit<Extract<InboxItem, { kind: "mended" }>, "id" | "tokenId" | "createdAt" | "readAt" | "kind" | "batched">,
  now: Date,
  today: string,
): Promise<InboxItem | null> {
  const todays = await db
    .selectFrom("inbox")
    .select(["id"])
    .where("token_id", "=", target)
    .where("kind", "=", "mended")
    .where("created_at", ">=", dayStart(today))
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  if (todays.length >= ECON.mendNotifyDailyCap && todays[0]) {
    await db
      .updateTable("inbox")
      .set({
        payload: sql`jsonb_set(payload, '{batched}', to_jsonb(COALESCE((payload->>'batched')::int, 0) + 1))`,
        read_at: null,
      })
      .where("id", "=", todays[0].id)
      .execute();
    return null;
  }
  const payload = Object.fromEntries(Object.entries({ ...fields, batched: 0 }).filter(([k]) => !RESERVED.has(k)));
  const row = await db
    .insertInto("inbox")
    .values({
      id: `n_${randomBytes(12).toString("base64url")}`,
      token_id: target,
      kind: "mended",
      payload: JSON.stringify(payload),
      created_at: now,
      read_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return itemFromRow(row);
}

/** Unread inbox items of a Friend. */
export async function unreadCount(db: Executor, tokenId: TokenIdStr): Promise<number> {
  const row = await db
    .selectFrom("inbox")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("token_id", "=", tokenId)
    .where("read_at", "is", null)
    .executeTakeFirstOrThrow();
  return Number(row.n);
}
