import {
  EMPTY_MASK,
  ROOMS,
  fnv1a32,
  isTokenIdStr,
  weiToMicro,
  type AppearanceRes,
  type BoardEntry,
  type DailyBoardRes,
  type DailySeed,
  type EconomyStatsRes,
  type InboxItem,
  type InboxReadRes,
  type InboxRes,
  type MeRes,
  type PublicRes,
  type RoomSlug,
  type SkyFriend,
  type SkyRes,
  type TokenIdStr,
} from "@pl/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sql } from "kysely";
import { RUN_RECHECK_MS, requireBinding } from "../auth/binding.js";
import { readGuest, readSession, requireSession } from "../auth/session.js";
import type { AppContext } from "../context.js";
import { dailySeed, nextMidnightUtc, utcDay } from "../game/daily.js";
import { bitsBalance, grantDailySim, simBalance } from "../game/wallet.js";
import { HttpError, validated } from "../http/errors.js";
import { enforceRateLimit } from "../http/guards.js";
import { itemFromRow, unreadCount } from "../inbox/store.js";

/** Resting Friends per room in `/api/sky` (architecture §1b.1). */
export const SKY_MAX = 30;
/** Only Friends seen within this window rest in the Sky. */
const SKY_RECENT_MS = 14 * 86_400_000;
const BOARD_TOP = 100;
const INBOX_PAGE = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The room a resting Friend sleeps in: a stable spread over the D-09 rooms. */
export function skyRoomOf(tokenId: TokenIdStr): RoomSlug {
  return ROOMS[fnv1a32(`pixel-life/sky/${tokenId}`) % ROOMS.length] ?? "plaza";
}

const tokenParam = (raw: unknown): TokenIdStr => {
  if (!isTokenIdStr(raw)) throw new HttpError(400, "bad_request", "Invalid token id.");
  return raw;
};

/** Public, CDN-cacheable response (edge Worker and browsers). */
const cachePublic = (reply: FastifyReply, seconds: number, extra = "") =>
  reply.header("cache-control", `public, max-age=${seconds}${extra}`);

/** Registers the Friend, Sky, Daily, inbox, stats and `/api/me` endpoints (architecture §4.3). */
export function registerWorldRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { id: string } }>("/api/friends/:id/appearance", async (request, reply): Promise<AppearanceRes> => {
    const art = await ctx.friends.appearance(tokenParam(request.params.id));
    // Registry art never changes: cache for a year, everywhere.
    cachePublic(reply, 31_536_000, ", immutable");
    reply.header("access-control-allow-origin", "*");
    return art;
  });

  app.get<{ Params: { id: string } }>("/api/friends/:id/public", async (request, reply): Promise<PublicRes> => {
    const pub = await ctx.friends.publicState(tokenParam(request.params.id));
    // The one endpoint sandboxed venues may read (architecture §4.3): CORS * and a short shared cache.
    reply.header("access-control-allow-origin", "*");
    if (!pub)
      throw new HttpError(404, "not_found", "This Friend has never visited Pixel Life.", { reason: "unknown_friend" });
    cachePublic(reply, 15);
    return pub;
  });

  app.get("/api/me", async (request): Promise<MeRes> => {
    const economy = ctx.config.economyMode;
    const session = await readSession(ctx, request.headers);
    if (session) {
      const binding = await ctx.repos.bindings.get(session.sid);
      let friend = null;
      let balanceMicro: number | null = null;
      let unread = 0;
      if (binding) {
        if (economy === "sim") await grantDailySim(ctx.db.kysely, binding.tokenId, utcDay(ctx.now()));
        friend = await ctx.friends.view(binding.tokenId);
        balanceMicro = economy === "sim" ? await simBalance(ctx.db.kysely, binding.tokenId) : null;
        unread = await unreadCount(ctx.db.kysely, binding.tokenId);
      }
      return {
        identity: { kind: "owner", address: session.address },
        friend,
        balanceMicro,
        unread,
        economy,
        bits: await bitsBalance(ctx.db.kysely, session.address),
      };
    }
    const guest = readGuest(ctx, request.headers);
    return {
      identity: guest ? { kind: "guest", guestId: guest.guestId } : { kind: "anon" },
      friend: null,
      balanceMicro: null,
      unread: 0,
      economy,
    };
  });

  app.get("/api/sky", async (request, reply): Promise<SkyRes> => {
    const { room } = validated("GET /api/sky", request.query);
    const since = new Date(ctx.now().getTime() - SKY_RECENT_MS);
    // Recently active first, scarred ones preferred (they are Mend targets); filtered to this room and to owners not
    // currently online (online Friends are live presences, not resting ones).
    const rows = await ctx.db.kysely
      .selectFrom("friends")
      .selectAll()
      .where("last_seen", ">", since)
      .orderBy(sql`(lost <> ${EMPTY_MASK})`, "desc")
      .orderBy("last_seen", "desc")
      .limit(SKY_MAX * ROOMS.length * 4)
      .execute();
    const picked = rows
      .filter((r) => skyRoomOf(r.token_id) === room && !(r.last_owner && ctx.hub.directory.ownerRoute(r.last_owner)))
      .slice(0, SKY_MAX);
    const art = await ctx.friends.art.peek(picked.map((r) => r.token_id));
    const friends: SkyFriend[] = await Promise.all(
      picked.map(async (row) => ({
        tokenId: row.token_id,
        familyId: art.get(row.token_id)?.familyId ?? (row.family_id as SkyFriend["familyId"]),
        pub: await ctx.friends.toPublic(row, art.get(row.token_id) ?? null),
      })),
    );
    cachePublic(reply, 15);
    return { room, friends };
  });

  app.get("/api/daily", async (_request, reply): Promise<DailySeed> => {
    const now = ctx.now();
    const day = utcDay(now);
    cachePublic(reply, 60);
    return { day, seed: dailySeed(day, ctx.config.dailySecret), endsAt: nextMidnightUtc(now) };
  });

  app.get<{ Params: { day: string } }>("/api/daily/:day/board", async (request, reply): Promise<DailyBoardRes> => {
    const { day } = request.params;
    if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      throw new HttpError(400, "bad_request", "Day must be YYYY-MM-DD.");
    }
    const { board } = validated("GET /api/daily/:day/board", request.query);
    const rows = await ctx.db.kysely
      .selectFrom("daily_best as b")
      .innerJoin("runs as r", "r.id", "b.run_id")
      .select(["b.entrant", "b.score", "b.run_id", "r.verified", "r.token_id"])
      .where("b.day", "=", day)
      .where("b.board", "=", board)
      .where("r.verified", ">=", 0)
      .orderBy("b.score", "desc")
      .orderBy("r.created_at", "asc")
      .limit(BOARD_TOP)
      .execute();
    const toEntry = (r: (typeof rows)[number], rank: number): BoardEntry => ({
      rank,
      entrant: r.entrant,
      tokenId: board === "owners" ? r.entrant : null,
      score: r.score,
      runId: r.run_id,
      verified: r.verified === 1 ? "ok" : r.verified === -1 ? "mismatch" : "pending",
    });
    const entries = rows.map((r, i) => toEntry(r, i + 1));

    // The caller's own row, even outside the top 100.
    let mine: string | null = null;
    const session = await readSession(ctx, request.headers);
    if (board === "owners" && session) mine = (await ctx.repos.bindings.get(session.sid))?.tokenId ?? null;
    if (board === "visitors") mine = readGuest(ctx, request.headers)?.guestId ?? null;
    let me: BoardEntry | null = entries.find((e) => e.entrant === mine) ?? null;
    if (!me && mine) {
      const own = await ctx.db.kysely
        .selectFrom("daily_best as b")
        .innerJoin("runs as r", "r.id", "b.run_id")
        .select(["b.entrant", "b.score", "b.run_id", "r.verified", "r.token_id", "r.created_at"])
        .where("b.day", "=", day)
        .where("b.board", "=", board)
        .where("b.entrant", "=", mine)
        .where("r.verified", ">=", 0)
        .executeTakeFirst();
      if (own) {
        const better = await ctx.db.kysely
          .selectFrom("daily_best as b")
          .innerJoin("runs as r", "r.id", "b.run_id")
          .select((eb) => eb.fn.countAll<string>().as("n"))
          .where("b.day", "=", day)
          .where("b.board", "=", board)
          .where("r.verified", ">=", 0)
          .where((eb) =>
            eb.or([
              eb("b.score", ">", own.score),
              eb.and([eb("b.score", "=", own.score), eb("r.created_at", "<", own.created_at)]),
            ]),
          )
          .executeTakeFirstOrThrow();
        me = toEntry(own, Number(better.n) + 1);
      }
    }
    if (!mine) cachePublic(reply, 10);
    return { day, board, entries, me };
  });

  app.get("/api/inbox", async (request): Promise<InboxRes> => {
    const session = await requireSession(ctx, request.headers);
    const binding = await requireBinding(ctx, session, RUN_RECHECK_MS);
    const rows = await ctx.db.kysely
      .selectFrom("inbox")
      .selectAll()
      .where("token_id", "=", binding.tokenId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(INBOX_PAGE)
      .execute();
    const items = rows.map(itemFromRow).filter((i): i is InboxItem => i !== null);
    return { items, unread: await unreadCount(ctx.db.kysely, binding.tokenId) };
  });

  app.post("/api/inbox/read", async (request): Promise<InboxReadRes> => {
    const session = await requireSession(ctx, request.headers);
    enforceRateLimit(ctx.limiters.writes, `addr:${session.address.toLowerCase()}`);
    const body = validated("POST /api/inbox/read", request.body);
    const binding = await requireBinding(ctx, session, RUN_RECHECK_MS);
    let q = ctx.db.kysely
      .updateTable("inbox")
      .set({ read_at: ctx.now() })
      .where("token_id", "=", binding.tokenId)
      .where("read_at", "is", null);
    if ("ids" in body) {
      if (body.ids.length === 0) return { unread: await unreadCount(ctx.db.kysely, binding.tokenId) };
      q = q.where("id", "in", body.ids);
    }
    await q.execute();
    return { unread: await unreadCount(ctx.db.kysely, binding.tokenId) };
  });

  app.get("/api/stats/economy", async (_request, reply): Promise<EconomyStatsRes> => {
    const mode = ctx.config.economyMode;
    const sums = await ctx.db.kysely
      .selectFrom("rf_ledger")
      .select((eb) => [
        eb.fn.coalesce(eb.fn.sum<string>("burn"), eb.val("0")).as("burn"),
        eb.fn.coalesce(eb.fn.sum<string>("stream"), eb.val("0")).as("stream"),
        eb.fn.coalesce(eb.fn.sum<string>("to_target"), eb.val("0")).as("to_target"),
        eb.fn.min("created_at").as("since"),
        eb.fn.countAll<string>().filterWhere("kind", "=", "regrow").as("regrow"),
        eb.fn.countAll<string>().filterWhere("kind", "=", "mend").as("mend"),
      ])
      .where("mode", "=", mode)
      .executeTakeFirstOrThrow();
    const house = await ctx.db.kysely.selectFrom("seedpack_house").select("packs_sold").executeTakeFirst();
    // Sums come back as numeric strings in wei; the DTO speaks micro-RF.
    const toMicro = (v: string) => weiToMicro(String(v).split(".")[0] ?? "0");
    cachePublic(reply, 30);
    return {
      mode,
      simulated: mode === "sim",
      burnedMicro: toMicro(sums.burn),
      streamMicro: toMicro(sums.stream),
      toFriendsMicro: toMicro(sums.to_target),
      counts: { regrow: Number(sums.regrow), mend: Number(sums.mend), seedPacks: house?.packs_sold ?? 0 },
      since: sums.since ? new Date(sums.since).getTime() : 0,
      updatedAt: ctx.now().getTime(),
    };
  });
}
