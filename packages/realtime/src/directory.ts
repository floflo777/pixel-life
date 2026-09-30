import { ROOM_HARD_CAP, ROOM_SOFT_CAP, ROOMS, type RoomSlug } from "@pl/shared";

/** Shard address, as in the RoomDO design: `room:{slug}:{shard}`. */
export type ShardId = `room:${RoomSlug}:${number}`;

/** Builds a shard id. */
export function shardId(slug: RoomSlug, shard: number): ShardId {
  return `room:${slug}:${shard}`;
}

/** Default number of shards a room may open (60 × 16 = 960 players per room, far beyond hackathon scale). */
export const MAX_SHARDS = 16;

/** Directory tuning. */
export interface DirectoryOptions {
  readonly softCap?: number;
  readonly hardCap?: number;
  readonly maxShards?: number;
}

/** Result of a shard assignment. */
export type Assignment = { ok: true; shard: number; shardId: ShardId } | { ok: false; reason: "full" };

/**
 * Parses an invite's `?shard=` value: a small non-negative integer, else null (ignored, never an error: a stale or
 * mangled invite link should still get you into the room).
 */
export function parseShardParam(raw: string | null | undefined, maxShards = MAX_SHARDS): number | null {
  if (raw === null || raw === undefined || !/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n < maxShards ? n : null;
}

/**
 * The in-process `DirectoryDO`: shard assignment, per-room populations for door badges, and `onlineOwners` routing
 * for notifications (architecture §1b.1, §4.7). Pure bookkeeping; the `Hub` keeps it in sync with rooms.
 */
export class Directory {
  readonly softCap: number;
  readonly hardCap: number;
  readonly maxShards: number;
  readonly #counts = new Map<ShardId, number>();
  readonly #owners = new Map<string, { shard: ShardId; session: string }>();

  /** Creates an empty directory. */
  constructor(options: DirectoryOptions = {}) {
    this.softCap = options.softCap ?? ROOM_SOFT_CAP;
    this.hardCap = options.hardCap ?? ROOM_HARD_CAP;
    this.maxShards = options.maxShards ?? MAX_SHARDS;
    if (!(this.softCap <= this.hardCap)) throw new RangeError("softCap must not exceed hardCap");
  }

  /**
   * Picks a shard for a newcomer. An invite (`requested`) is honoured up to the hard cap; otherwise the lowest
   * shard below the soft cap wins (so shards fill in order and new ones open only when all are busy); when every
   * shard is at the soft cap, the lowest below the hard cap. Does not reserve: call {@link occupy} on join.
   */
  assign(slug: RoomSlug, requested: number | null = null): Assignment {
    if (requested !== null && Number.isInteger(requested) && requested >= 0 && requested < this.maxShards) {
      if (this.count(shardId(slug, requested)) < this.hardCap) return this.#ok(slug, requested);
    }
    for (const cap of [this.softCap, this.hardCap]) {
      for (let s = 0; s < this.maxShards; s++) if (this.count(shardId(slug, s)) < cap) return this.#ok(slug, s);
    }
    return { ok: false, reason: "full" };
  }

  /** Records a member joining `id`. */
  occupy(id: ShardId): void {
    this.#counts.set(id, this.count(id) + 1);
  }

  /** Records a member leaving `id` (never below zero). */
  release(id: ShardId): void {
    const n = this.count(id) - 1;
    if (n > 0) this.#counts.set(id, n);
    else this.#counts.delete(id);
  }

  /** Members in one shard. */
  count(id: ShardId): number {
    return this.#counts.get(id) ?? 0;
  }

  /** Occupied shards of a room with their populations, lowest shard first. */
  shards(slug: RoomSlug): { shard: number; count: number }[] {
    const out: { shard: number; count: number }[] = [];
    for (let s = 0; s < this.maxShards; s++) {
      const count = this.count(shardId(slug, s));
      if (count > 0) out.push({ shard: s, count });
    }
    return out;
  }

  /** Total players per room across shards (the door badge "● 6 here"). */
  populations(): Record<RoomSlug, number> {
    const out = Object.fromEntries(ROOMS.map((r) => [r, 0])) as Record<RoomSlug, number>;
    for (const [id, n] of this.#counts) {
      const slug = id.split(":")[1] as RoomSlug;
      out[slug] += n;
    }
    return out;
  }

  /** Marks an owner address online in `shard` via `session` (one live session per owner; the newest wins). */
  ownerOnline(address: string, shard: ShardId, session: string): void {
    this.#owners.set(address.toLowerCase(), { shard, session });
  }

  /** Marks an owner offline, but only if `session` is still the one on record (a newer tab may have taken over). */
  ownerOffline(address: string, session: string): void {
    const key = address.toLowerCase();
    if (this.#owners.get(key)?.session === session) this.#owners.delete(key);
  }

  /** Where an owner is right now, for routing `notify`; undefined when offline. */
  ownerRoute(address: string): { shard: ShardId; session: string } | undefined {
    return this.#owners.get(address.toLowerCase());
  }

  /** Number of owners online. */
  get onlineOwners(): number {
    return this.#owners.size;
  }

  #ok(slug: RoomSlug, shard: number): Assignment {
    return { ok: true, shard, shardId: shardId(slug, shard) };
  }
}
