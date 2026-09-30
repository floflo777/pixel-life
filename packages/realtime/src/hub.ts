import {
  type ClientMsgType,
  encodeMsg,
  type InboxItem,
  type RateRule,
  type RoomSlug,
  type ServerMsg,
  type TokenIdStr,
  WS_CLOSE,
  type WsCloseCode,
} from "@pl/shared";
import { type Clock, systemClock } from "./clock.js";
import { Directory, type DirectoryOptions, type ShardId, shardId } from "./directory.js";
import type { Vec2 } from "./geometry.js";
import { type HubNavmesh, Navmesh } from "./navmesh.js";
import { type ConnId, type MemberProfile, type Outbound, Room } from "./room.js";
import { HUB_NAVMESHES, isRoomSlug } from "./rooms.js";
import type { RoomTransport } from "./transport.js";

/** Standard close code used when the hub shuts down. */
export const CLOSE_GOING_AWAY = 1001;

/** Hub tuning and wiring. Everything but `transport` has a production default. */
export interface HubOptions<S> {
  readonly transport: RoomTransport<S>;
  readonly clock?: Clock;
  readonly navmeshes?: Readonly<Record<RoomSlug, HubNavmesh>>;
  readonly directory?: DirectoryOptions;
  readonly rates?: Readonly<Record<ClientMsgType, RateRule>>;
  readonly maxViolations?: number;
  readonly violationDecayMs?: number;
  readonly isVenue?: (venueId: string) => boolean;
  /** Observability hook (joins, leaves, kicks); must not throw. */
  readonly onEvent?: (event: HubEvent) => void;
}

/** Lifecycle events for logs and metrics. */
export type HubEvent =
  | { type: "join"; session: string; shard: ShardId; identityKey: string }
  | { type: "leave"; session: string; shard: ShardId }
  | { type: "close"; session: string; shard: ShardId; code: number; reason: string }
  | { type: "refused"; identityKey: string; room: string; code: number; reason: string };

/** Everything the server resolved about a new socket before handing it over. */
export interface HubJoin {
  /** Stable per identity (`owner:<address>` / `guest:<id>`): one presence per identity, the newest socket wins. */
  readonly identityKey: string;
  /** Owner wallet address for `notify` routing; null for guests. */
  readonly owner: string | null;
  /** Room slug from the URL (`/ws/room/:slug`). */
  readonly room: string;
  /** Invite shard from `?shard=` (see `parseShardParam`); null for automatic placement. */
  readonly shard?: number | null;
  /** Room the Friend walked in from (`?from=`), so it appears on the matching bridge. */
  readonly from?: string | null;
  readonly profile: MemberProfile;
}

/** A joined socket's handle. The server calls `receive` per text frame and `leave` once on socket close. */
export interface HubSession {
  readonly id: ConnId;
  readonly entityId: string;
  readonly room: RoomSlug;
  readonly shard: number;
  readonly shardId: ShardId;
  /** Feeds one raw text frame from the client. Never throws. */
  receive(frame: string): void;
  /** The socket closed (idempotent). */
  leave(): void;
}

/** Outcome of {@link Hub.join}. On failure the hub has already sent `kick` and closed the socket. */
export type HubJoinResult = { ok: true; session: HubSession } | { ok: false; code: WsCloseCode; reason: string };

interface SessionState<S> {
  readonly id: ConnId;
  readonly socket: S;
  readonly identityKey: string;
  readonly owner: string | null;
  readonly room: Room;
  readonly shardId: ShardId;
  open: boolean;
}

/**
 * The in-process hub: a registry of sharded {@link Room}s plus the {@link Directory}, delivering room output through
 * a {@link RoomTransport}. Single-threaded and synchronous, so assignment + join are atomic without locks.
 */
export class Hub<S> {
  readonly directory: Directory;
  readonly #o: HubOptions<S>;
  readonly #clock: Clock;
  readonly #meshes = new Map<RoomSlug, Navmesh>();
  readonly #rooms = new Map<ShardId, Room>();
  readonly #sessions = new Map<ConnId, SessionState<S>>();
  readonly #byIdentity = new Map<string, ConnId>();
  #seq = 0;

  /** Creates a hub with every room of `navmeshes` (default: the five D-09 rooms). */
  constructor(options: HubOptions<S>) {
    this.#o = options;
    this.#clock = options.clock ?? systemClock;
    this.directory = new Directory(options.directory);
    const meshes = options.navmeshes ?? HUB_NAVMESHES;
    for (const [slug, data] of Object.entries(meshes)) {
      if (isRoomSlug(slug)) this.#meshes.set(slug, new Navmesh(data));
    }
  }

  /** Whether `slug` is a joinable room (check before upgrading the socket). */
  has(slug: string): slug is RoomSlug {
    return isRoomSlug(slug) && this.#meshes.has(slug);
  }

  /** The navmesh of a room (clients get the same data from this package). */
  navmesh(slug: RoomSlug): Navmesh | undefined {
    return this.#meshes.get(slug);
  }

  /** Open sessions. */
  get sessionCount(): number {
    return this.#sessions.size;
  }

  /** Live room shards. */
  get roomCount(): number {
    return this.#rooms.size;
  }

  /**
   * Places a socket in a shard and sends it `welcome`. Never throws. A previous session of the same identity is
   * closed with `replaced` (4009) first. On failure (unknown room, all shards full) the socket is kicked and closed.
   */
  join(socket: S, req: HubJoin): HubJoinResult {
    const mesh = this.has(req.room) ? this.#meshes.get(req.room) : undefined;
    if (!mesh || !isRoomSlug(req.room)) return this.#refuse(socket, req, WS_CLOSE.badMessage, "unknown room");
    const slug = req.room;

    const previous = this.#byIdentity.get(req.identityKey);
    if (previous !== undefined) this.#closeSession(previous, WS_CLOSE.replaced, "replaced by a newer connection");

    const assignment = this.directory.assign(slug, req.shard ?? null);
    if (!assignment.ok) return this.#refuse(socket, req, WS_CLOSE.roomFull, "all shards are full");
    const room = this.#room(slug, assignment.shard, mesh);

    const id = this.#mint("c");
    const from = req.from ?? null;
    const joined = room.join(id, req.profile, from !== null ? { from } : null);
    if (!joined) return this.#refuse(socket, req, WS_CLOSE.roomFull, "shard is full");

    const state: SessionState<S> = {
      id,
      socket,
      identityKey: req.identityKey,
      owner: req.owner,
      room,
      shardId: assignment.shardId,
      open: true,
    };
    this.#sessions.set(id, state);
    this.#byIdentity.set(req.identityKey, id);
    this.directory.occupy(assignment.shardId);
    if (req.owner) this.directory.ownerOnline(req.owner, assignment.shardId, id);
    this.#emit({ type: "join", session: id, shard: assignment.shardId, identityKey: req.identityKey });
    this.#deliver(room, joined.out);

    return {
      ok: true,
      session: {
        id,
        entityId: joined.entityId,
        room: slug,
        shard: assignment.shard,
        shardId: assignment.shardId,
        receive: (frame) => {
          if (state.open) this.#deliver(room, room.receive(id, frame));
        },
        leave: () => this.#leave(id),
      },
    };
  }

  /** Pushes an inbox notification to an online owner (architecture §4.7). Returns whether it was delivered. */
  notify(address: string, item: InboxItem): boolean {
    const route = this.directory.ownerRoute(address);
    const s = route ? this.#sessions.get(route.session) : undefined;
    if (!s?.open) return false;
    this.#deliver(s.room, s.room.sendTo(s.id, ["notify", item]));
    return true;
  }

  /**
   * Relays a Mend sparkle to every shard where the target or the payer is present (the payer's room sees its own
   * stitch even when mending a resting Friend). Returns the number of shards reached.
   */
  mended(target: TokenIdStr, by: TokenIdStr, px: number): number {
    const rooms = new Set<Room>([...this.#roomsWithToken(target), ...this.#roomsWithToken(by)]);
    for (const room of rooms) this.#deliver(room, room.broadcast(["mended", target, by, px]));
    return rooms.size;
  }

  /** Updates a Friend's public state everywhere it is present and relays `scars` when its hash changed. */
  updateToken(tokenId: TokenIdStr, patch: { scarsHash?: string; goldHeld?: number }): void {
    for (const room of this.#roomsWithToken(tokenId)) this.#deliver(room, room.updateToken(tokenId, patch));
  }

  /** A server-originated event for everyone in one room slug (all shards), e.g. a venue opening. */
  broadcastRoom(slug: RoomSlug, msg: ServerMsg): void {
    for (const room of this.#rooms.values()) if (room.slug === slug) this.#deliver(room, room.broadcast(msg));
  }

  /** Players per room (door badges). */
  populations(): Record<RoomSlug, number> {
    return this.directory.populations();
  }

  /** Where an entity currently is, for tests and admin tools. */
  snapshot(id: ShardId): ReturnType<Room["snapshot"]> {
    return this.#rooms.get(id)?.snapshot() ?? [];
  }

  /** Closes every session (graceful shutdown). */
  close(code: number = CLOSE_GOING_AWAY, reason = "server shutdown"): void {
    for (const id of [...this.#sessions.keys()]) this.#closeSession(id, code, reason);
  }

  #room(slug: RoomSlug, shard: number, mesh: Navmesh): Room {
    const id = shardId(slug, shard);
    let room = this.#rooms.get(id);
    if (!room) {
      const arrivals: Record<string, Vec2> = {};
      for (const d of mesh.data.doors) if (d.kind === "room") arrivals[d.target] = d.spawn;
      room = new Room({
        slug,
        shard,
        walkable: mesh,
        clock: this.#clock,
        spawns: mesh.data.spawns,
        arrivals,
        hardCap: this.directory.hardCap,
        nextEntityId: () => this.#mint("e"),
        ...(this.#o.rates ? { rates: this.#o.rates } : {}),
        ...(this.#o.maxViolations !== undefined ? { maxViolations: this.#o.maxViolations } : {}),
        ...(this.#o.violationDecayMs !== undefined ? { violationDecayMs: this.#o.violationDecayMs } : {}),
        ...(this.#o.isVenue ? { isVenue: this.#o.isVenue } : {}),
      });
      this.#rooms.set(id, room);
    }
    return room;
  }

  #roomsWithToken(tokenId: TokenIdStr): Room[] {
    return [...this.#rooms.values()].filter((r) => r.connsOfToken(tokenId).length > 0);
  }

  #deliver(room: Room, out: readonly Outbound[]): void {
    const t = this.#o.transport;
    for (const o of out) {
      if (o.kind === "send") {
        const s = this.#sessions.get(o.conn);
        if (s?.open) t.send(s.socket, encodeMsg(o.msg));
      } else if (o.kind === "broadcast") {
        const frame = encodeMsg(o.msg);
        for (const conn of room.conns()) {
          if (conn === o.except) continue;
          const s = this.#sessions.get(conn);
          if (s?.open) t.send(s.socket, frame);
        }
      } else {
        const s = this.#sessions.get(o.conn);
        if (s) this.#forget(s, o.code, o.reason);
      }
    }
  }

  /** Server-initiated close of a live session: tell it why, remove it from its room, close the socket. */
  #closeSession(id: ConnId, code: WsCloseCode | number, reason: string): void {
    const s = this.#sessions.get(id);
    if (!s?.open) return;
    const isApp = code >= 4000 && code <= 4999;
    if (isApp) this.#o.transport.send(s.socket, encodeMsg(["kick", code]));
    const out = s.room.leave(id);
    this.#forget(s, code, reason);
    this.#deliver(s.room, out);
  }

  /** Peer closed: leave the room quietly (idempotent). */
  #leave(id: ConnId): void {
    const s = this.#sessions.get(id);
    if (!s?.open) return;
    s.open = false;
    this.#cleanup(s);
    this.#emit({ type: "leave", session: id, shard: s.shardId });
    this.#deliver(s.room, s.room.leave(id));
    this.#dropIfEmpty(s);
  }

  #forget(s: SessionState<S>, code: number, reason: string): void {
    if (!s.open) return;
    s.open = false;
    this.#cleanup(s);
    this.#emit({ type: "close", session: s.id, shard: s.shardId, code, reason });
    this.#o.transport.close(s.socket, code, reason);
    this.#dropIfEmpty(s);
  }

  #cleanup(s: SessionState<S>): void {
    this.#sessions.delete(s.id);
    if (this.#byIdentity.get(s.identityKey) === s.id) this.#byIdentity.delete(s.identityKey);
    this.directory.release(s.shardId);
    if (s.owner) this.directory.ownerOffline(s.owner, s.id);
  }

  #dropIfEmpty(s: SessionState<S>): void {
    if (s.room.size === 0 && this.#rooms.get(s.shardId) === s.room) this.#rooms.delete(s.shardId);
  }

  #refuse(socket: S, req: HubJoin, code: WsCloseCode, reason: string): HubJoinResult {
    this.#o.transport.send(socket, encodeMsg(["kick", code]));
    this.#o.transport.close(socket, code, reason);
    this.#emit({ type: "refused", identityKey: req.identityKey, room: req.room, code, reason });
    return { ok: false, code, reason };
  }

  #mint(prefix: string): string {
    return prefix + (++this.#seq).toString(36);
  }

  #emit(e: HubEvent): void {
    try {
      this.#o.onEvent?.(e);
    } catch {
      // Observability must never break presence.
    }
  }
}
