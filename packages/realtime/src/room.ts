import {
  CLIENT_RATES,
  type ClientMsg,
  type ClientMsgType,
  decodeClientFrame,
  MAX_RATE_VIOLATIONS,
  type PresenceEntity,
  ROOM_HARD_CAP,
  type RateRule,
  type RoomSlug,
  type ServerMsg,
  type TokenIdStr,
  WS_CLOSE,
  type WsCloseCode,
} from "@pl/shared";
import { TokenBucket } from "./bucket.js";
import type { Clock } from "./clock.js";
import { dist, type Vec2 } from "./geometry.js";
import { MAX_MOVE_DISTANCE, positionAt, type Segment, isMoving } from "./motion.js";
import type { Walkable } from "./navmesh.js";

/** Identifies one socket inside the realtime layer (opaque, unique per connection). */
export type ConnId = string;

/** A message a room wants delivered; the host (see `Hub`) turns these into transport calls. */
export type Outbound =
  | { readonly kind: "send"; readonly conn: ConnId; readonly msg: ServerMsg }
  /** To every member of the room except `except` (null = everyone). Encoded once, fanned out by the host. */
  | { readonly kind: "broadcast"; readonly except: ConnId | null; readonly msg: ServerMsg }
  /** Close the socket. The member has already been removed from the room. */
  | { readonly kind: "close"; readonly conn: ConnId; readonly code: WsCloseCode; readonly reason: string };

/** What the server knows about a joining Friend. Appearance is never sent on the socket (architecture §1b.1). */
export interface MemberProfile {
  readonly kind: "owner" | "guest";
  readonly tokenId: TokenIdStr;
  /** Guests walk loaned Friends ("on loan #65042"). */
  readonly loaned: boolean;
  readonly scarsHash: string;
  readonly goldHeld: number;
}

/** Where a joining Friend appears. */
export type SpawnHint = { readonly from: string } | { readonly at: Vec2 } | null;

/** Room tuning. Defaults come from `@pl/shared` so server and docs agree. */
export interface RoomOptions {
  readonly slug: RoomSlug;
  readonly shard: number;
  readonly walkable: Walkable;
  readonly clock: Clock;
  /** Default spawn points (walkable). */
  readonly spawns: readonly Vec2[];
  /** Arrival point per origin room slug (a Friend coming from `pixel-arena` appears on the arena bridge). */
  readonly arrivals?: Readonly<Record<string, Vec2>>;
  readonly hardCap?: number;
  readonly rates?: Readonly<Record<ClientMsgType, RateRule>>;
  readonly maxViolations?: number;
  /** One violation is forgiven per this many ms without a new one, so rare honest bursts never add up to a kick. */
  readonly violationDecayMs?: number;
  /** Optional allow-list for `venue` ids (unknown ids are ignored, not punished). */
  readonly isVenue?: (venueId: string) => boolean;
  /** Mints entity ids; must be unique across the hub. */
  readonly nextEntityId: () => string;
}

/** Default forgiveness window for rate violations. */
export const VIOLATION_DECAY_MS = 30_000;

interface Member {
  readonly conn: ConnId;
  readonly entity: PresenceEntity;
  motion: Segment | null;
  lastSeq: number;
  readonly buckets: Record<ClientMsgType, TokenBucket>;
  violations: number;
  lastViolationAt: number;
}

/**
 * One room shard: the in-process replacement for `RoomDO` (architecture §1b.1 + hosting decision). A pure state
 * machine: `join` / `leave` / `handle` return the messages to deliver and never touch a socket. No tick: positions
 * are derived from the last `moved` segment and the clock, so an idle room costs nothing.
 */
export class Room {
  readonly slug: RoomSlug;
  readonly shard: number;
  readonly #o: RoomOptions;
  readonly #members = new Map<ConnId, Member>();
  readonly #rates: Readonly<Record<ClientMsgType, RateRule>>;
  #spawnCursor = 0;

  /** Creates an empty shard. */
  constructor(options: RoomOptions) {
    this.#o = options;
    this.slug = options.slug;
    this.shard = options.shard;
    this.#rates = options.rates ?? CLIENT_RATES;
  }

  /** Current number of members. */
  get size(): number {
    return this.#members.size;
  }

  /** True when `conn` is in this room. */
  has(conn: ConnId): boolean {
    return this.#members.has(conn);
  }

  /** Entity id of a member, if present. */
  entityId(conn: ConnId): string | undefined {
    return this.#members.get(conn)?.entity.id;
  }

  /** Connections of members walking `tokenId` (normally 0 or 1). */
  connsOfToken(tokenId: TokenIdStr): ConnId[] {
    return [...this.#members.values()].filter((m) => m.entity.tokenId === tokenId).map((m) => m.conn);
  }

  /** Every member's connection id. */
  conns(): ConnId[] {
    return [...this.#members.keys()];
  }

  /**
   * Adds a member: `welcome` (with the full roster, self included) plus the in-flight walks to the joiner, `join` to
   * everyone else. Returns null when the shard is at its hard cap (the Directory should not let that happen).
   */
  join(conn: ConnId, profile: MemberProfile, spawn: SpawnHint = null): { entityId: string; out: Outbound[] } | null {
    if (this.#members.has(conn)) throw new Error(`connection ${conn} already joined`);
    if (this.#members.size >= (this.#o.hardCap ?? ROOM_HARD_CAP)) return null;
    const now = this.#o.clock.now();
    const at = this.#spawnPoint(spawn);
    const entity: PresenceEntity = {
      id: this.#o.nextEntityId(),
      kind: profile.kind,
      tokenId: profile.tokenId,
      loaned: profile.loaned,
      x: at[0],
      z: at[1],
      venue: null,
      scarsHash: profile.scarsHash,
      goldHeld: profile.goldHeld,
    };
    const buckets = Object.fromEntries(
      Object.entries(this.#rates).map(([type, rule]) => [type, new TokenBucket(rule, now)]),
    ) as Record<ClientMsgType, TokenBucket>;
    const member: Member = { conn, entity, motion: null, lastSeq: -1, buckets, violations: 0, lastViolationAt: now };
    this.#members.set(conn, member);

    const out: Outbound[] = [{ kind: "send", conn, msg: ["welcome", entity.id, this.snapshot(), now] }];
    // The roster only carries where everyone is *now*; replay walks still in progress so the joiner animates them.
    for (const m of this.#members.values()) {
      if (m.motion && isMoving(m.motion, now)) {
        const s = m.motion;
        out.push({ kind: "send", conn, msg: ["moved", m.entity.id, s.fx, s.fz, s.tx, s.tz, s.t0] });
      }
    }
    out.push({ kind: "broadcast", except: conn, msg: ["join", { ...entity }] });
    return { entityId: entity.id, out };
  }

  /** Removes a member (idempotent) and tells the others. */
  leave(conn: ConnId): Outbound[] {
    const m = this.#members.get(conn);
    if (!m) return [];
    this.#members.delete(conn);
    return [{ kind: "broadcast", except: null, msg: ["leave", m.entity.id] }];
  }

  /** Decodes one raw text frame from `conn` and handles it; malformed frames count as violations. */
  receive(conn: ConnId, frame: string): Outbound[] {
    const parsed = decodeClientFrame(frame);
    if (!parsed.ok) return this.#violation(conn, WS_CLOSE.badMessage, parsed.error);
    return this.handle(conn, parsed.value);
  }

  /** Handles one validated client message: rate limit first, then the message's own rules. */
  handle(conn: ConnId, msg: ClientMsg): Outbound[] {
    const m = this.#members.get(conn);
    if (!m) return [];
    const now = this.#o.clock.now();
    if (!m.buckets[msg[0]].take(now)) return this.#violation(conn, WS_CLOSE.rateLimited, `${msg[0]} rate exceeded`);
    const id = m.entity.id;
    switch (msg[0]) {
      case "move":
        return this.#move(m, msg[1], [msg[2], msg[3]], now);
      case "emote":
        return [{ kind: "broadcast", except: null, msg: ["emote", id, msg[1]] }];
      case "say":
        return [{ kind: "broadcast", except: null, msg: ["say", id, msg[1]] }];
      case "venue": {
        const venue = msg[1];
        if (venue !== null && this.#o.isVenue && !this.#o.isVenue(venue)) return [];
        if (m.entity.venue === venue) return [];
        m.entity.venue = venue;
        return [{ kind: "broadcast", except: null, msg: ["venue", id, venue] }];
      }
      case "ping":
        // `pong` carries the server clock; the client pairs it with its single in-flight ping to measure RTT.
        return [{ kind: "send", conn, msg: ["pong", now] }];
    }
  }

  /** Roster with everyone's current (interpolated, rounded) position. */
  snapshot(): PresenceEntity[] {
    const now = this.#o.clock.now();
    return [...this.#members.values()].map((m) => {
      const [x, z] = this.#current(m, now);
      return { ...m.entity, x, z };
    });
  }

  /** Updates scars/gold of every member walking `tokenId` and relays `scars` when the hash changed. */
  updateToken(tokenId: TokenIdStr, patch: { scarsHash?: string; goldHeld?: number }): Outbound[] {
    const out: Outbound[] = [];
    for (const m of this.#members.values()) {
      if (m.entity.tokenId !== tokenId) continue;
      if (patch.goldHeld !== undefined) m.entity.goldHeld = patch.goldHeld;
      if (patch.scarsHash !== undefined && patch.scarsHash !== m.entity.scarsHash) {
        m.entity.scarsHash = patch.scarsHash;
        if (out.length === 0) out.push({ kind: "broadcast", except: null, msg: ["scars", tokenId, patch.scarsHash] });
      }
    }
    return out;
  }

  /** A server-originated event for everyone in the room (e.g. `mended`). */
  broadcast(msg: ServerMsg): Outbound[] {
    return this.#members.size === 0 ? [] : [{ kind: "broadcast", except: null, msg }];
  }

  /** A server-originated message for one member (e.g. `notify`); empty when `conn` is not here. */
  sendTo(conn: ConnId, msg: ServerMsg): Outbound[] {
    return this.#members.has(conn) ? [{ kind: "send", conn, msg }] : [];
  }

  /** Removes a member and closes its socket with `code` (sends `kick` first so the client can explain why). */
  kick(conn: ConnId, code: WsCloseCode, reason: string): Outbound[] {
    if (!this.#members.has(conn)) return [];
    return [{ kind: "send", conn, msg: ["kick", code] }, ...this.leave(conn), { kind: "close", conn, code, reason }];
  }

  #move(m: Member, seq: number, target: Vec2, now: number): Outbound[] {
    // Reordered or replayed input is stale by definition; TCP keeps order, so this only drops duplicates.
    if (seq <= m.lastSeq) return [];
    m.lastSeq = seq;
    const walk = this.#o.walkable;
    if (!walk.contains(target)) return [];
    const from = this.#current(m, now);
    let goal = target;
    const d = dist(from, goal);
    if (d > MAX_MOVE_DISTANCE) {
      const k = MAX_MOVE_DISTANCE / d;
      goal = [Math.round(from[0] + (goal[0] - from[0]) * k), Math.round(from[1] + (goal[1] - from[1]) * k)];
    }
    // A Friend stranded off the mesh (map edit) may walk straight to any walkable point to recover.
    const to = walk.contains(from) ? this.#clipRounded(from, goal) : goal;
    m.motion = { fx: from[0], fz: from[1], tx: to[0], tz: to[1], t0: now };
    m.entity.x = to[0];
    m.entity.z = to[1];
    return [{ kind: "broadcast", except: null, msg: ["moved", m.entity.id, from[0], from[1], to[0], to[1], now] }];
  }

  /** Clip, round to the int16 grid, and step back until the rounded point is strictly walkable. */
  #clipRounded(from: Vec2, goal: Vec2): Vec2 {
    const walk = this.#o.walkable;
    const q = walk.clip(from, goal);
    const len = dist(from, q);
    for (let back = 0; back <= len; back += 5) {
      const k = len === 0 ? 0 : (len - back) / len;
      const r: Vec2 = [Math.round(from[0] + (q[0] - from[0]) * k), Math.round(from[1] + (q[1] - from[1]) * k)];
      if (walk.contains(r)) return r;
    }
    return from;
  }

  #current(m: Member, now: number): Vec2 {
    if (!m.motion) return [m.entity.x, m.entity.z];
    const p = positionAt(m.motion, now);
    return [Math.round(p[0]), Math.round(p[1])];
  }

  #spawnPoint(hint: SpawnHint): Vec2 {
    if (hint && "at" in hint && this.#o.walkable.contains(hint.at)) return hint.at;
    if (hint && "from" in hint) {
      const arrival = this.#o.arrivals?.[hint.from];
      if (arrival) return arrival;
    }
    const spawns = this.#o.spawns;
    if (spawns.length === 0) throw new Error(`room ${this.slug} has no spawn points`);
    // Round-robin so a burst of arrivals does not stack on one tile.
    const p = spawns[this.#spawnCursor % spawns.length] as Vec2;
    this.#spawnCursor++;
    return p;
  }

  #violation(conn: ConnId, code: WsCloseCode, reason: string): Outbound[] {
    const m = this.#members.get(conn);
    if (!m) return [];
    const now = this.#o.clock.now();
    const decay = this.#o.violationDecayMs ?? VIOLATION_DECAY_MS;
    const forgiven = decay > 0 ? Math.floor((now - m.lastViolationAt) / decay) : 0;
    m.violations = Math.max(0, m.violations - forgiven) + 1;
    m.lastViolationAt = now;
    if (m.violations >= (this.#o.maxViolations ?? MAX_RATE_VIOLATIONS)) return this.kick(conn, code, reason);
    return [];
  }
}
