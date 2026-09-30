import { WS_CLOSE } from "@pl/shared";
import type { WebSocket } from "ws";

/** Who is on the other end of a socket. Owners were eligibility-checked at a fresh block during the upgrade. */
export type SocketIdentity =
  | {
      readonly kind: "owner";
      /** Stable per identity: `owner:<address>`. At most 2 sockets share it (the oldest is kicked). */
      readonly key: string;
      readonly address: string;
      readonly sid: string;
      readonly tokenId: string;
      readonly tba: string;
    }
  | { readonly kind: "guest"; readonly key: string; readonly guestId: string };

/** An accepted, authenticated socket handed to a room. The room owns its lifecycle from then on. */
export interface RoomConnection {
  readonly socket: WebSocket;
  readonly identity: SocketIdentity;
  readonly slug: string;
  readonly ip: string;
  readonly requestId: string;
  /** Raw query string of the upgrade URL (`?shard=`, `?from=`, `?loan=`), without the leading `?`. */
  readonly query: string;
}

/**
 * The realtime layer's contract (architecture §1b.1, in-process replacement for RoomDO/DirectoryDO).
 * `createHubRoomRegistry` (ws/hub-registry.ts) implements it on the @pl/realtime Hub; the stub below stays for tests.
 */
export interface RoomRegistry {
  /** Whether `slug` names a joinable room (unknown slugs are refused with 404 before upgrading). */
  has(slug: string): boolean;
  /** Takes ownership of a freshly upgraded socket. Must not throw; failures close the socket. */
  join(connection: RoomConnection): void;
  /** Closes every room and socket (graceful shutdown). */
  close(): Promise<void>;
}

/** Close codes the bootstrap layer uses: the shared `WS_CLOSE` application codes plus standard 1001/1011. */
export const CLOSE_CODES = Object.freeze({
  ...WS_CLOSE,
  /** Server shutting down (RFC 6455). */
  goingAway: 1001,
  /** The room failed to take the socket (RFC 6455 "internal error"). */
  internalError: 1011,
});

/**
 * Test registry: accepts sockets for the configured slugs, ignores their messages, and keeps them open so the
 * upgrade/auth path is exercisable end to end without the hub.
 */
export function createStubRoomRegistry(
  slugs: readonly string[],
): RoomRegistry & { readonly connections: ReadonlySet<RoomConnection> } {
  const known = new Set(slugs);
  const connections = new Set<RoomConnection>();
  return {
    connections,
    has: (slug) => known.has(slug),
    join(connection) {
      connections.add(connection);
      connection.socket.on("close", () => connections.delete(connection));
    },
    async close() {
      for (const connection of connections) connection.socket.close(CLOSE_CODES.goingAway, "server shutdown");
      connections.clear();
    },
  };
}
