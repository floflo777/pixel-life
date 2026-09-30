import { Hub, parseShardParam, socketTransport, type HubEvent, type HubSession } from "@pl/realtime";
import { EMPTY_MASK, WS_CLOSE, isTokenIdStr, scarsHash, type TokenIdStr } from "@pl/shared";
import type { FastifyBaseLogger } from "fastify";
import type { RawData, WebSocket } from "ws";
import type { FriendViews } from "../friends/view.js";
import type { RoomConnection, RoomRegistry } from "./rooms.js";

/** Loaner a guest walks when the client names none (Mask #344030, the landing Friend). */
export const DEFAULT_LOANER: TokenIdStr = "344030";
/** Frames buffered per socket while its presence is being resolved (a join takes one DB read). */
const MAX_EARLY_FRAMES = 32;

/** The server's hub: `@pl/realtime` over `ws` sockets. */
export type ServerHub = Hub<WebSocket>;

/** Creates the in-process hub (hosting decision: RoomDO/DirectoryDO as in-memory classes), logging its lifecycle. */
export function createServerHub(log: FastifyBaseLogger): ServerHub {
  return new Hub<WebSocket>({
    transport: socketTransport<WebSocket>(),
    onEvent: (event: HubEvent) => log.debug({ hub: event }, "hub event"),
  });
}

/**
 * Implements the bootstrap's `RoomRegistry` on the hub (PR #9 integration notes): resolves the presence profile
 * (owners: settled scars + live Gold from the DB; guests: a loaned Friend, whole), then joins with `?shard=`/`?from=`,
 * forwards text frames to the session, and leaves on close. Frames arriving during resolution are buffered.
 */
export function createHubRoomRegistry(deps: {
  readonly hub: ServerHub;
  readonly friends: FriendViews;
  readonly log: FastifyBaseLogger;
  /** Configured room slugs (`ROOMS` env); the hub must also have a navmesh for them. */
  readonly rooms: readonly string[];
}): RoomRegistry {
  const { hub, friends, log } = deps;
  const pending = new Set<Promise<void>>();

  const join = async (conn: RoomConnection) => {
    const { socket, identity } = conn;
    const early: string[] = [];
    let session: HubSession | null = null;
    let closed = false;
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        socket.close(WS_CLOSE.badMessage, "binary frames are not accepted");
        return;
      }
      const frame = Buffer.isBuffer(data)
        ? data.toString()
        : Array.isArray(data)
          ? Buffer.concat(data).toString()
          : Buffer.from(data).toString();
      if (session) session.receive(frame);
      else if (early.length < MAX_EARLY_FRAMES) early.push(frame);
    });
    socket.once("close", () => {
      closed = true;
      session?.leave();
    });

    const query = new URLSearchParams(conn.query);
    let profile;
    if (identity.kind === "owner") {
      const pub = await friends.publicState(identity.tokenId);
      profile = {
        kind: "owner" as const,
        tokenId: identity.tokenId,
        loaned: false,
        scarsHash: scarsHash(pub?.scars ?? { lost: EMPTY_MASK, updatedAt: 0, version: 0 }),
        goldHeld: pub?.goldHeld ?? 0,
      };
    } else {
      const loan = query.get("loan");
      profile = {
        kind: "guest" as const,
        tokenId: loan && isTokenIdStr(loan) ? loan : DEFAULT_LOANER,
        loaned: true,
        // Guest scars live in localStorage (D-11): presence shows the loaner whole.
        scarsHash: scarsHash({ lost: EMPTY_MASK, updatedAt: 0, version: 0 }),
        goldHeld: 0,
      };
    }
    if (closed) return;
    const result = hub.join(socket, {
      identityKey: identity.key,
      owner: identity.kind === "owner" ? identity.address : null,
      room: conn.slug,
      shard: parseShardParam(query.get("shard")),
      from: query.get("from"),
      profile,
    });
    if (!result.ok) return; // the hub already sent `kick` and closed the socket
    session = result.session;
    for (const frame of early.splice(0)) session.receive(frame);
  };

  return {
    has: (slug) => deps.rooms.includes(slug) && hub.has(slug),
    join(conn) {
      const p = join(conn).catch((error: unknown) => {
        log.error({ err: error, requestId: conn.requestId }, "hub join failed");
        conn.socket.close(1011, "room unavailable");
      });
      pending.add(p);
      void p.finally(() => pending.delete(p));
    },
    async close() {
      await Promise.allSettled([...pending]);
      hub.close();
    },
  };
}
