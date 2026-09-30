/**
 * Wire protocol: hub WebSocket messages (compact JSON tuples, architecture §1b.1) and REST DTOs for every endpoint in
 * architecture §4.3 (served by `apps/server` per the hosting decision).
 *
 * Everything a client sends is untrusted: servers parse WebSocket frames with `decodeClientFrame` and request bodies with
 * the exported zod schemas (`parseBody`). Servers never accept client-computed prices or scars; they recompute them.
 */
import { z } from "zod";
import type { EconomyAction, EconomyMode, EconomyQuote, EconomyReceipt } from "./economy.js";
import type { FriendAppearance, FriendPublic, FriendView, ScarState } from "./friend.js";
import { type FamilyId, isHex64, isTokenIdStr, type TokenIdStr } from "./ids.js";
import type { MarketInboxItem } from "./market.js";
import { RUN_TICKS, type RunKind, type RunSummary } from "./sim-types.js";
import { fnv1a32 } from "./util.js";

// ── Hub constants ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Hub room slugs (architecture §1b.1). A room is sharded server-side; clients only name the slug. */
export const ROOMS = ["plaza", "pixel-arena", "seed-booth", "sky-docks", "daily-gate"] as const;
/** A hub room slug. */
export type RoomSlug = (typeof ROOMS)[number];
/** Players per room shard before a new shard is preferred. */
export const ROOM_SOFT_CAP = 40;
/** Players per room shard, never exceeded. */
export const ROOM_HARD_CAP = 60;

/** Emote wheel in id order (GDD §11.4); the wire carries the index. */
export const EMOTES = ["wave", "hop", "spin", "heart", "pixel-burst", "sit", "flex", "stomp"] as const;
/** An emote name. */
export type EmoteName = (typeof EMOTES)[number];
/** Quick-chat ("safe chat") phrase ids are 0..QUICK_CHAT_PHRASES-1; the phrase text table lives in the client. */
export const QUICK_CHAT_PHRASES = 16;

/** Hub coordinates are int16 centimetres on the ground plane. */
export const COORD_MIN = -32768;
/** Hub coordinates are int16 centimetres on the ground plane. */
export const COORD_MAX = 32767;
/** Largest accepted client WebSocket frame, in UTF-16 code units (a `move` is ~30). */
export const MAX_CLIENT_FRAME = 256;

/** Per-socket token bucket for one client message type: sustained rate and burst size. */
export interface RateRule {
  readonly perSec: number;
  readonly burst: number;
}

/** Per-socket client message rates (architecture §1b.1). `ping` is not specified there; 1/s burst 2 is ours. */
export const CLIENT_RATES: Readonly<Record<ClientMsgType, RateRule>> = Object.freeze({
  move: { perSec: 8, burst: 16 },
  emote: { perSec: 1, burst: 1 },
  say: { perSec: 0.5, burst: 1 },
  venue: { perSec: 2, burst: 2 },
  ping: { perSec: 1, burst: 2 },
});
/** Rate violations tolerated before the socket is closed with `WS_CLOSE.rateLimited`. */
export const MAX_RATE_VIOLATIONS = 3;

/** WebSocket close / kick codes (4000-4999 are application codes). */
export const WS_CLOSE = Object.freeze({
  badMessage: 4000,
  unauthorized: 4001,
  notOwner: 4003,
  rateLimited: 4008,
  /** A newer socket for the same identity took over (at most 2 per identity; the oldest is kicked). */
  replaced: 4009,
  roomFull: 4029,
} as const);
/** A WebSocket application close code. */
export type WsCloseCode = (typeof WS_CLOSE)[keyof typeof WS_CLOSE];

// ── WebSocket messages ────────────────────────────────────────────────────────────────────────────────────────────

/** Client → server hub messages (JSON arrays). */
export type ClientMsg =
  | ["move", seq: number, x: number, z: number]
  | ["emote", id: number]
  | ["say", phraseId: number]
  | ["venue", venueId: string | null]
  | ["ping", t: number];

/** Tag of a client message. */
export type ClientMsgType = ClientMsg[0];

/** A Friend present in a room shard. Appearance is fetched over REST, never sent on the socket. */
export interface PresenceEntity {
  id: string;
  kind: "owner" | "guest";
  tokenId: TokenIdStr;
  loaned: boolean;
  x: number;
  z: number;
  venue: string | null;
  scarsHash: string;
  goldHeld: number;
}

/** Server → client hub messages (JSON arrays). */
export type ServerMsg =
  | ["welcome", you: string, roster: PresenceEntity[], serverTime: number]
  | ["join", e: PresenceEntity]
  | ["leave", id: string]
  | ["moved", id: string, fx: number, fz: number, tx: number, tz: number, t0: number]
  | ["emote", id: string, emote: number]
  | ["say", id: string, phraseId: number]
  | ["venue", id: string, venueId: string | null]
  | ["scars", tokenId: TokenIdStr, scarsHash: string]
  | ["mended", target: TokenIdStr, by: TokenIdStr, px: number]
  | ["notify", n: InboxItem]
  | ["pong", t: number]
  | ["kick", code: number];

/** Tag of a server message. */
export type ServerMsgType = ServerMsg[0];

/** Every server message tag, for exhaustive client dispatch tables. */
export const SERVER_MSG_TYPES = [
  "welcome",
  "join",
  "leave",
  "moved",
  "emote",
  "say",
  "venue",
  "scars",
  "mended",
  "notify",
  "pong",
  "kick",
] as const satisfies readonly ServerMsgType[];

// ── Inbox ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fields common to every inbox notification. `readAt` is null while unread. */
interface InboxBase {
  id: string;
  tokenId: TokenIdStr;
  createdAt: number;
  readAt: number | null;
}

/** An in-app notification for a Friend's owner (GDD §5.9). Discriminated by `kind`. */
export type InboxItem =
  | (InboxBase & {
      kind: "mended";
      /** Paying Friend. */
      by: TokenIdStr;
      px: number;
      /** RF paid into this Friend's wallet (micro-RF). */
      toTargetMicro: number;
      mode: EconomyMode;
      /** Body region name (GDD §9.5), or null for "a few pixels". */
      region: string | null;
      /** Further Mends batched into this one after the daily individual cap. */
      batched: number;
    })
  | (InboxBase & { kind: "whole" })
  | (InboxBase & { kind: "badge"; day: string; tier: "gold" | "silver" })
  | (InboxBase & { kind: "daily"; day: string })
  | (InboxBase & { kind: "streak_risk"; streak: number })
  /** A SIMULATED Gold market sale (seller) or royalty (origin Friend), written by the market. Additive. */
  | MarketInboxItem;

/** Tag of an inbox item. */
export type InboxKind = InboxItem["kind"];

// ── REST DTOs (architecture §4.3) ─────────────────────────────────────────────────────────────────────────────────

/** Error body of every non-2xx response. */
export interface ApiError {
  error: ApiErrorCode;
  message?: string;
  /** For `rate_limited`: when to retry. */
  retryAfterMs?: number;
}

/** Machine-readable API error codes. `not_owner` makes the client re-pick its Friend (architecture §1.6). */
export type ApiErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "guest_forbidden"
  | "not_owner"
  | "not_found"
  | "rate_limited"
  | "insufficient_funds"
  | "not_lost"
  | "mend_cap"
  | "scar_conflict"
  | "quote_expired"
  | "tx_unverified"
  | "seedpack_reserve"
  | "no_pixels"
  | "too_many_pixels"
  | "bad_token"
  | "bad_mask"
  | "self_mend"
  /** The request needs a signed-in owner session (401). */
  | "no_session"
  /** A dependency (chain RPC, replay pool, feature) is temporarily unavailable: retry later (503). */
  | "unavailable"
  | "internal";

/** `POST /api/guest` → guest cookie issued. */
export interface GuestRes {
  guestId: string;
}

/** `GET /api/auth/nonce` → single-use SIWE nonce (5 min). */
export interface NonceRes {
  nonce: string;
}

/** `POST /api/auth/verify` body: the EIP-4361 message and its `personal_sign` signature. */
export interface VerifyReq {
  message: string;
  signature: `0x${string}`;
}

/** `POST /api/auth/verify` → session cookie issued for `address`. */
export interface VerifyRes {
  address: `0x${string}`;
}

/** `POST /api/auth/logout` and other acknowledgement-only responses. */
export interface OkRes {
  ok: true;
}

/** `POST /api/session/friend` body; the response is the bound `FriendView`. */
export interface SessionFriendReq {
  tokenId: TokenIdStr;
}

/** Who the caller is, as seen by the server. */
export type MeIdentity =
  { kind: "anon" } | { kind: "guest"; guestId: string } | { kind: "owner"; address: `0x${string}` };

/** `GET /api/me` → identity, bound Friend, balance and unread inbox count. */
export interface MeRes {
  identity: MeIdentity;
  friend: FriendView | null;
  /** Bound Friend's simulated balance (sim mode, owners only). */
  balanceMicro: number | null;
  unread: number;
  economy: EconomyMode;
  /** Account Bits balance (owners only; guests keep Bits locally). Additive. */
  bits?: number;
  /** False when the server's guest-mode kill switch is off (D-15): hide "play as guest". Additive. */
  guestMode?: boolean;
}

/** `GET /api/friends/:id/appearance` (immutable). */
export type AppearanceRes = FriendAppearance;
/** `GET /api/friends/:id/public` (15 s cache, CORS `*`). */
export type PublicRes = FriendPublic;

/** `POST /api/runs` body. `inputs` is base64 of `encodeInputs(...)` (<= 8 KiB decoded). */
export interface RunSubmitReq {
  venueId: string;
  kind: RunKind;
  seed: number;
  /** UTC day `YYYY-MM-DD`, required for daily runs. */
  day?: string;
  inputs: string;
  claimed: RunSummary;
  /** Sim arena (island) the run was played on; default `meadow`. Additive: needed to replay the run. */
  arena?: string;
  /**
   * The Fling Belt whose trial this run was (GDD §12.4). Additive. Only honoured for a free Loose Pixels run played on
   * `beltTrialSeed(beltTrial)`; the belt is awarded after replay verification if the run meets its requirement.
   */
  beltTrial?: string;
}

/**
 * Venues whose runs play the deterministic Loose Pixels sim: the server replays them and they affect scars, stamps and
 * belts. The handheld plays the same sim, so its runs count as Pixel Life runs for stamps and belts.
 */
export const SCAR_VENUES = Object.freeze(["pixel-life", "handheld"] as const);
/**
 * Venues whose runs only earn Bits (under a per-venue daily cap) and are not replayed yet: their scores are
 * client-claimed, so they never touch scars, stamps, belts or boards. Free runs only.
 */
export const BITS_ONLY_VENUES = Object.freeze(["bump-sumo", "pixel-putt"] as const);
/** A venue id `POST /api/runs` accepts. */
export type RunVenueId = (typeof SCAR_VENUES)[number] | (typeof BITS_ONLY_VENUES)[number];

/** True if `id` is a venue `POST /api/runs` accepts. */
export function isRunVenue(id: string): id is RunVenueId {
  return (SCAR_VENUES as readonly string[]).includes(id) || (BITS_ONLY_VENUES as readonly string[]).includes(id);
}

/** The fixed seed of a Fling Belt trial (same for everyone, forever): FNV-1a of `pixel-life/belt/<id>`. */
export function beltTrialSeed(beltId: string): number {
  return fnv1a32(`pixel-life/belt/${beltId}`);
}

/** Replay verification state of a run (`runs.verified`: 0 / 1 / -1). */
export type RunVerification = "pending" | "ok" | "mismatch";

/** Why a run's scars were not persisted, when `applied` is false. */
export type RunNotAppliedReason =
  | "guest"
  | "practice"
  | "newbie"
  | "floor"
  | "unverified"
  | "not_owner"
  /** The venue never affects scars (`BITS_ONLY_VENUES`). Additive. */
  | "no_scars";

/** `POST /api/runs` → acknowledgement (`ResultAck` for venues). `scars` is the owner Friend's state after the run. */
export interface RunAck {
  runId: string;
  verified: RunVerification;
  applied: boolean;
  reason?: RunNotAppliedReason;
  scars: ScarState | null;
  /** Bits credited for this run after the daily cap (owners only). Additive. */
  bits?: number;
}

/** `GET /api/daily` → today's seed. `endsAt` is the next 00:00 UTC in ms. */
export interface DailySeed {
  day: string;
  seed: number;
  endsAt: number;
}

/** Daily leaderboard selector. */
export type BoardKind = "owners" | "visitors";

/** One leaderboard row. `entrant` is a token id (owners) or a guest id (visitors). */
export interface BoardEntry {
  rank: number;
  entrant: string;
  tokenId: TokenIdStr | null;
  score: number;
  runId: string;
  verified: RunVerification;
}

/** `GET /api/daily/:day/board?board=` → top 100 plus the caller's row. */
export interface DailyBoardRes {
  day: string;
  board: BoardKind;
  entries: BoardEntry[];
  me: BoardEntry | null;
}

/** `POST /api/economy/quote` body. */
export type QuoteReq = EconomyAction;
/** `POST /api/economy/quote` → the pure quote; live mode adds the quote id and the 15 min pixel lock. */
export type QuoteRes = EconomyQuote & { quoteId?: string; lockedUntil?: number };

/** `POST /api/economy/regrow` and `/api/economy/mend` body. Live mode supplies the paid `quoteId` + `txHash`. */
export interface EconomyRequestReq {
  action: EconomyAction;
  quoteId?: string;
  txHash?: `0x${string}`;
}
/** `POST /api/economy/{regrow,mend}` → receipt. */
export type EconomyRequestRes = EconomyReceipt;

/** Seed-pack ledger actions, backing the SDK `GameClient` (`ServerLedgerClient`). */
export const SEEDPACK_OPS = ["read", "canBuy", "buy", "play", "settle", "redeem"] as const;
/** A seed-pack ledger action. */
export type SeedPackOp = (typeof SEEDPACK_OPS)[number];

/** Decimal string of a non-negative bigint (JSON cannot carry bigint). */
export type BigIntStr = string;

/** SDK `GamePlay` over JSON. */
export interface GamePlayDto {
  id: BigIntStr;
  outcomeId: number | null;
}

/** SDK `GameSnapshot` over JSON (all bigint fields as decimal strings). */
export interface GameSnapshotDto {
  mode: "preview" | "chain";
  friendId: BigIntStr;
  rfBalance: BigIntStr;
  consumables: BigIntStr;
  stake: BigIntStr;
  freeStake: BigIntStr;
  reservedPlays: BigIntStr;
  rewardLiability: BigIntStr;
  inventory: BigIntStr[];
  plays: GamePlayDto[];
}

/** Request/response pairs of `POST /api/seedpack/:op`. */
export interface SeedPackApi {
  read: { req: Record<string, never>; res: GameSnapshotDto };
  canBuy: { req: { quantity: BigIntStr }; res: { ok: boolean } };
  buy: { req: { quantity: BigIntStr }; res: GameSnapshotDto };
  play: { req: { quantity?: BigIntStr }; res: { plays: GamePlayDto[] } };
  settle: { req: { playId: BigIntStr }; res: GamePlayDto };
  redeem: { req: { outcomeId: number; quantity: BigIntStr }; res: GameSnapshotDto };
}

/** A resting (offline) Friend shown in a room. Appearance comes from `/appearance`. */
export interface SkyFriend {
  tokenId: TokenIdStr;
  familyId: FamilyId;
  pub: FriendPublic;
}

/** `GET /api/sky?room=` → at most 30 resting Friends. */
export interface SkyRes {
  room: RoomSlug;
  friends: SkyFriend[];
}

/** `GET /api/inbox` → newest first. */
export interface InboxRes {
  items: InboxItem[];
  unread: number;
}

/** `POST /api/inbox/read` body: mark the given ids (<= 100) or everything as read. */
export type InboxReadReq = { ids: string[] } | { all: true };
/** `POST /api/inbox/read` → remaining unread count. */
export interface InboxReadRes {
  unread: number;
}

/** `GET /api/stats/economy` → aggregate RF flows. `simulated: true` must be shown as SIMULATED in the UI. */
export interface EconomyStatsRes {
  mode: EconomyMode;
  simulated: boolean;
  burnedMicro: number;
  streamMicro: number;
  toFriendsMicro: number;
  counts: { regrow: number; mend: number; seedPacks: number };
  since: number;
  updatedAt: number;
}

/** Request type of endpoints that take no body or query. */
export type NoBody = undefined;

/** Typed map of every REST endpoint (architecture §4.3): key = `METHOD path`, value = request body/query and response. */
export interface ApiEndpoints {
  "POST /api/guest": { req: NoBody; res: GuestRes };
  "GET /api/auth/nonce": { req: NoBody; res: NonceRes };
  "POST /api/auth/verify": { req: VerifyReq; res: VerifyRes };
  "POST /api/auth/logout": { req: NoBody; res: OkRes };
  "POST /api/session/friend": { req: SessionFriendReq; res: FriendView };
  /** Drops the session's bound Friend (the client re-picks after an account or Friend change). */
  "DELETE /api/session/friend": { req: NoBody; res: OkRes };
  "GET /api/me": { req: NoBody; res: MeRes };
  "GET /api/friends/:id/appearance": { req: NoBody; res: AppearanceRes };
  "GET /api/friends/:id/public": { req: NoBody; res: PublicRes };
  "POST /api/runs": { req: RunSubmitReq; res: RunAck };
  "GET /api/daily": { req: NoBody; res: DailySeed };
  "GET /api/daily/:day/board": { req: { board: BoardKind }; res: DailyBoardRes };
  "POST /api/economy/quote": { req: QuoteReq; res: QuoteRes };
  "POST /api/economy/regrow": { req: EconomyRequestReq; res: EconomyRequestRes };
  "POST /api/economy/mend": { req: EconomyRequestReq; res: EconomyRequestRes };
  "POST /api/seedpack/read": { req: SeedPackApi["read"]["req"]; res: SeedPackApi["read"]["res"] };
  "POST /api/seedpack/canBuy": { req: SeedPackApi["canBuy"]["req"]; res: SeedPackApi["canBuy"]["res"] };
  "POST /api/seedpack/buy": { req: SeedPackApi["buy"]["req"]; res: SeedPackApi["buy"]["res"] };
  "POST /api/seedpack/play": { req: SeedPackApi["play"]["req"]; res: SeedPackApi["play"]["res"] };
  "POST /api/seedpack/settle": { req: SeedPackApi["settle"]["req"]; res: SeedPackApi["settle"]["res"] };
  "POST /api/seedpack/redeem": { req: SeedPackApi["redeem"]["req"]; res: SeedPackApi["redeem"]["res"] };
  "GET /api/sky": { req: { room: RoomSlug }; res: SkyRes };
  "GET /api/inbox": { req: NoBody; res: InboxRes };
  "POST /api/inbox/read": { req: InboxReadReq; res: InboxReadRes };
  "GET /api/stats/economy": { req: NoBody; res: EconomyStatsRes };
}
/** An endpoint key of `ApiEndpoints`. */
export type ApiRoute = keyof ApiEndpoints;

// ── Runtime validation (zod) ──────────────────────────────────────────────────────────────────────────────────────

const int = (min: number, max: number) => z.int().min(min).max(max);
const coord = int(COORD_MIN, COORD_MAX);
/** Venue ids are short lowercase slugs ("pixel-life", "seed-pack"). */
const VENUE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_TX_RE = /^0x[0-9a-fA-F]{64}$/;

/** A canonical token id string. */
export const tokenIdSchema = z.string().refine(isTokenIdStr, "invalid token id");
/** A canonical `Hex64` mask (lowercase, no prefix). */
export const hex64Schema = z.string().refine(isHex64, "invalid pixel mask");
/** A venue id slug. */
export const venueIdSchema = z.string().regex(VENUE_ID_RE);
/** A UTC day `YYYY-MM-DD`. */
export const daySchema = z.string().regex(DAY_RE);
/** A non-negative bigint as a decimal string of at most 78 digits. */
export const bigIntStrSchema = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const txHashSchema = z.custom<`0x${string}`>((v) => typeof v === "string" && HEX_TX_RE.test(v), "invalid tx hash");

const clientSchemas = {
  move: z.tuple([z.literal("move"), int(0, 0xffffffff), coord, coord]),
  emote: z.tuple([z.literal("emote"), int(0, EMOTES.length - 1)]),
  say: z.tuple([z.literal("say"), int(0, QUICK_CHAT_PHRASES - 1)]),
  venue: z.tuple([z.literal("venue"), venueIdSchema.nullable()]),
  ping: z.tuple([z.literal("ping"), z.number().min(0).max(Number.MAX_SAFE_INTEGER)]),
} as const satisfies Record<ClientMsgType, z.ZodType<ClientMsg>>;

function isClientMsgType(v: unknown): v is ClientMsgType {
  return typeof v === "string" && Object.hasOwn(clientSchemas, v);
}

/** Outcome of validating untrusted input. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates an already-JSON-decoded client message; never throws. */
export function parseClientMsg(raw: unknown): ParseResult<ClientMsg> {
  if (!Array.isArray(raw) || !isClientMsgType(raw[0])) return { ok: false, error: "unknown message" };
  const r = clientSchemas[raw[0]].safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: `invalid ${raw[0]}` };
}

/** Decodes and validates one client WebSocket text frame (size-limited JSON); never throws. */
export function decodeClientFrame(frame: string): ParseResult<ClientMsg> {
  if (frame.length > MAX_CLIENT_FRAME) return { ok: false, error: "frame too large" };
  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return { ok: false, error: "malformed json" };
  }
  return parseClientMsg(raw);
}

/** Serialises a message for the wire (compact JSON array). */
export function encodeMsg(m: ClientMsg | ServerMsg): string {
  return JSON.stringify(m);
}

/**
 * Decodes a server frame on the client. The server is trusted, so this only checks the envelope (array + known tag)
 * and returns null for anything else, e.g. a message type newer than this client.
 */
export function decodeServerFrame(frame: string): ServerMsg | null {
  let raw: unknown;
  try {
    raw = JSON.parse(frame);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || !(SERVER_MSG_TYPES as readonly unknown[]).includes(raw[0])) return null;
  return raw as ServerMsg;
}

/** `RunSummary` as claimed by a client (bounds only; the server replays to verify). */
export const runSummarySchema = z.object({
  score: int(0, 1e9),
  lostDelta: hex64Schema,
  recovered: int(0, 256 * RUN_TICKS),
  smashed: int(0, 1e6),
  ticks: int(0, RUN_TICKS),
  finalHash: z.string().regex(/^[0-9A-Za-z_-]{1,128}$/),
}) satisfies z.ZodType<RunSummary>;

/** An `EconomyAction` body. */
export const economyActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("regrow"), tokenId: tokenIdSchema, pixels: hex64Schema }),
  z.object({ kind: z.literal("mend"), payer: tokenIdSchema, target: tokenIdSchema, pixels: hex64Schema }),
]) satisfies z.ZodType<EconomyAction>;

/** Max base64 length of an 8 KiB input log. */
export const MAX_INPUTS_B64 = 10_924;

/** Zod schemas for every REST request body/query that carries data. */
export const requestSchemas = {
  "POST /api/auth/verify": z.object({
    message: z.string().min(1).max(4096),
    signature: z.custom<`0x${string}`>((v) => typeof v === "string" && /^0x[0-9a-fA-F]{2,2048}$/.test(v)),
  }),
  "POST /api/session/friend": z.object({ tokenId: tokenIdSchema }),
  "POST /api/runs": z
    .object({
      venueId: venueIdSchema,
      kind: z.enum(["free", "daily"]),
      seed: int(0, 0xffffffff),
      day: daySchema.exactOptional(),
      inputs: z.base64().max(MAX_INPUTS_B64),
      claimed: runSummarySchema,
      arena: venueIdSchema.exactOptional(),
      beltTrial: z
        .string()
        .regex(/^[a-z_]{1,32}$/)
        .exactOptional(),
    })
    .refine((r) => r.kind !== "daily" || r.day !== undefined, { message: "daily runs need a day", path: ["day"] }),
  "GET /api/daily/:day/board": z.object({ board: z.enum(["owners", "visitors"]) }),
  "POST /api/economy/quote": economyActionSchema,
  "POST /api/economy/regrow": z.object({
    action: economyActionSchema,
    quoteId: z.string().min(1).max(128).exactOptional(),
    txHash: txHashSchema.exactOptional(),
  }),
  "POST /api/economy/mend": z.object({
    action: economyActionSchema,
    quoteId: z.string().min(1).max(128).exactOptional(),
    txHash: txHashSchema.exactOptional(),
  }),
  "POST /api/seedpack/read": z.object({}).strict(),
  "POST /api/seedpack/canBuy": z.object({ quantity: bigIntStrSchema }),
  "POST /api/seedpack/buy": z.object({ quantity: bigIntStrSchema }),
  "POST /api/seedpack/play": z.object({ quantity: bigIntStrSchema.exactOptional() }),
  "POST /api/seedpack/settle": z.object({ playId: bigIntStrSchema }),
  "POST /api/seedpack/redeem": z.object({ outcomeId: int(1, 255), quantity: bigIntStrSchema }),
  "GET /api/sky": z.object({ room: z.enum(ROOMS) }),
  "POST /api/inbox/read": z.union([
    z.object({ ids: z.array(z.string().min(1).max(64)).max(100) }),
    z.object({ all: z.literal(true) }),
  ]),
} as const;

/** Routes that have a request schema. */
export type ValidatedRoute = keyof typeof requestSchemas;

type SchemaOut<R extends ValidatedRoute> = z.output<(typeof requestSchemas)[R]>;
type AssertAssignable<A extends B, B> = A;
/** Compile-time proof that each request schema's output is assignable to its endpoint's declared request type. */
export type RequestSchemaCheck = {
  [R in ValidatedRoute]: AssertAssignable<SchemaOut<R>, ApiEndpoints[R]["req"]>;
};

/** Validates an untrusted request body/query for `route`; never throws. */
export function parseBody<R extends ValidatedRoute>(route: R, raw: unknown): ParseResult<ApiEndpoints[R]["req"]> {
  const r = requestSchemas[route].safeParse(raw);
  if (r.success) return { ok: true, value: r.data as ApiEndpoints[R]["req"] };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
}

// ── Seed-pack snapshot codecs (SDK bigint ⇄ JSON) ─────────────────────────────────────────────────────────────────

/** Structural twin of SDK `GamePlay` (kept local so @pl/shared does not depend on the SDK at runtime). */
export interface GamePlayLike {
  readonly id: bigint;
  readonly outcomeId: number | null;
}

/** Structural twin of SDK `GameSnapshot`. */
export interface GameSnapshotLike {
  readonly mode: "preview" | "chain";
  readonly friendId: bigint;
  readonly rfBalance: bigint;
  readonly consumables: bigint;
  readonly stake: bigint;
  readonly freeStake: bigint;
  readonly reservedPlays: bigint;
  readonly rewardLiability: bigint;
  readonly inventory: readonly bigint[];
  readonly plays: readonly GamePlayLike[];
}

/** Encodes an SDK play for JSON. */
export function playToDto(p: GamePlayLike): GamePlayDto {
  return { id: p.id.toString(10), outcomeId: p.outcomeId };
}

/** Decodes a play DTO back to SDK shape; throws `RangeError` on a malformed id. */
export function playFromDto(p: GamePlayDto): GamePlayLike {
  return { id: parseBigIntStr(p.id), outcomeId: p.outcomeId };
}

/** Encodes an SDK snapshot for JSON (bigints → decimal strings). */
export function snapshotToDto(s: GameSnapshotLike): GameSnapshotDto {
  return {
    mode: s.mode,
    friendId: s.friendId.toString(10),
    rfBalance: s.rfBalance.toString(10),
    consumables: s.consumables.toString(10),
    stake: s.stake.toString(10),
    freeStake: s.freeStake.toString(10),
    reservedPlays: s.reservedPlays.toString(10),
    rewardLiability: s.rewardLiability.toString(10),
    inventory: s.inventory.map((v) => v.toString(10)),
    plays: s.plays.map(playToDto),
  };
}

/** Decodes a snapshot DTO to SDK shape (what `ServerLedgerClient.read()` returns); throws `RangeError` if malformed. */
export function snapshotFromDto(d: GameSnapshotDto): GameSnapshotLike {
  return {
    mode: d.mode,
    friendId: parseBigIntStr(d.friendId),
    rfBalance: parseBigIntStr(d.rfBalance),
    consumables: parseBigIntStr(d.consumables),
    stake: parseBigIntStr(d.stake),
    freeStake: parseBigIntStr(d.freeStake),
    reservedPlays: parseBigIntStr(d.reservedPlays),
    rewardLiability: parseBigIntStr(d.rewardLiability),
    inventory: d.inventory.map(parseBigIntStr),
    plays: d.plays.map(playFromDto),
  };
}

/** Parses a non-negative decimal bigint string; throws `RangeError` otherwise. */
export function parseBigIntStr(s: string): bigint {
  if (!bigIntStrSchema.safeParse(s).success) throw new RangeError("Expected a non-negative decimal integer string.");
  return BigInt(s);
}
