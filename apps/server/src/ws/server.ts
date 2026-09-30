import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { requireBinding } from "../auth/binding.js";
import { readGuest, readSession } from "../auth/session.js";
import type { AppContext } from "../context.js";
import { HttpError } from "../http/errors.js";
import { clientIpFrom, originAllowed, originKeyMatches } from "../http/guards.js";
import { CLOSE_CODES, type RoomConnection, type SocketIdentity } from "./rooms.js";

/** `/ws/room/:slug` */
const ROOM_PATH = /^\/ws\/room\/([a-z0-9][a-z0-9-]{0,31})$/;
/** Hub messages are ~40 B JSON arrays; anything near this is abuse. */
const MAX_PAYLOAD_BYTES = 4 * 1024;
const HEARTBEAT_MS = 30_000;
/** Architecture §4.5: at most 2 sockets per identity, the older one is kicked. */
const MAX_SOCKETS_PER_IDENTITY = 2;

/** Handle returned by {@link attachWebSocket}. */
export interface WebSocketLayer {
  /** Number of open sockets (tests, metrics). */
  size(): number;
  /** Stops accepting upgrades, closes rooms and terminates remaining sockets. */
  close(): Promise<void>;
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  503: "Service Unavailable",
};

/** Answers a refused upgrade with a plain HTTP response and closes the TCP socket. */
function refuse(socket: Duplex, error: HttpError, requestId: string): void {
  if (!socket.writable) return void socket.destroy();
  const { status } = error;
  const body = JSON.stringify(error.body(requestId));
  const extra = Object.entries(error.headers()).map(([k, v]) => `${k}: ${v}\r\n`);
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] ?? "Error"}\r\nConnection: close\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\n${extra.join("")}\r\n${body}`,
  );
}

/**
 * Resolves who is connecting (architecture §1.6 step 5, §1b.1 Join): an owner session with a binding that
 * passes a fresh-block eligibility re-check, else a guest cookie. An owner whose Friend is no longer
 * eligible is refused (403) rather than silently downgraded, so the client re-picks.
 */
async function resolveIdentity(ctx: AppContext, request: IncomingMessage): Promise<SocketIdentity> {
  const session = await readSession(ctx, request.headers);
  if (session) {
    const binding = await ctx.repos.bindings.get(session.sid);
    if (binding) {
      const fresh = await requireBinding(ctx, session, 0);
      const address = session.address.toLowerCase();
      return {
        kind: "owner",
        key: `owner:${address}`,
        address,
        sid: session.sid,
        tokenId: fresh.tokenId,
        tba: fresh.tba,
      };
    }
  }
  const guest = readGuest(ctx, request.headers);
  if (guest) return { kind: "guest", key: `guest:${guest.guestId}`, guestId: guest.guestId };
  if (session) throw new HttpError(403, "forbidden", "Pick one of your Friends first.", { reason: "no_binding" });
  throw new HttpError(401, "unauthorized", "Sign in or start as a guest first.");
}

/**
 * Handles HTTP upgrades on `server` for `/ws/room/:slug`: origin key → browser Origin → rate limit →
 * known room → identity → upgrade → room registry. Everything else is refused before any WebSocket exists.
 */
export function attachWebSocket(server: Server, ctx: AppContext, log: FastifyBaseLogger): WebSocketLayer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES, perMessageDeflate: false });
  const byIdentity = new Map<string, WebSocket[]>();
  const alive = new WeakSet<WebSocket>();
  let closing = false;

  const track = (key: string, socket: WebSocket) => {
    const list = byIdentity.get(key) ?? [];
    list.push(socket);
    byIdentity.set(key, list);
    while (list.length > MAX_SOCKETS_PER_IDENTITY)
      list.shift()?.close(CLOSE_CODES.replaced, "replaced by a newer connection");
    socket.once("close", () => {
      const current = byIdentity.get(key);
      if (!current) return;
      const rest = current.filter((s) => s !== socket);
      if (rest.length === 0) byIdentity.delete(key);
      else byIdentity.set(key, rest);
    });
  };

  const onUpgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const requestId = randomUUID();
    const ip = clientIpFrom(ctx.config, request.headers, request.socket.remoteAddress);
    const url = new URL(request.url ?? "/", "http://origin.invalid");
    const match = ROOM_PATH.exec(url.pathname);
    try {
      if (closing) throw new HttpError(503, "unavailable", "Server is shutting down.", { reason: "shutting_down" });
      if (!originKeyMatches(ctx.config, request.headers)) throw new HttpError(403, "forbidden", "Forbidden.");
      if (!match?.[1]) throw new HttpError(404, "not_found", "Unknown WebSocket path.");
      if (!originAllowed(ctx.config, request.headers.origin))
        throw new HttpError(403, "forbidden", "Origin not allowed.", { reason: "bad_origin" });
      const limit = ctx.limiters.wsConnect.take(`ip:${ip}`);
      if (!limit.ok) {
        throw new HttpError(429, "rate_limited", "Too many connections.", { retryAfterMs: limit.retryAfterMs });
      }
      const slug = match[1];
      if (!ctx.rooms.has(slug)) throw new HttpError(404, "not_found", "Unknown room.");
      const identity = await resolveIdentity(ctx, request);
      if (closing || socket.destroyed) return void socket.destroy();
      wss.handleUpgrade(request, socket, head, (ws) => {
        alive.add(ws);
        ws.on("pong", () => alive.add(ws));
        track(identity.key, ws);
        const connection: RoomConnection = { socket: ws, identity, slug, ip, requestId, query: url.search.slice(1) };
        log.info({ requestId, slug, kind: identity.kind, key: identity.key }, "ws joined");
        try {
          ctx.rooms.join(connection);
        } catch (error) {
          log.error({ err: error, requestId }, "room join failed");
          ws.close(CLOSE_CODES.internalError, "room unavailable");
        }
      });
    } catch (error) {
      if (error instanceof HttpError) {
        log.info(
          { requestId, ip, path: url.pathname, status: error.status, reason: error.reason },
          "ws upgrade refused",
        );
        refuse(socket, error, requestId);
      } else {
        log.error({ err: error, requestId }, "ws upgrade failed");
        refuse(socket, new HttpError(503, "internal", "Could not open the connection."), requestId);
      }
    }
  };

  const listener = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    void onUpgrade(request, socket, head);
  };
  server.on("upgrade", listener);

  // Dead peers (mobile sleep, NAT drop) never send close; ping them and terminate the silent ones.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    size: () => wss.clients.size,
    async close() {
      closing = true;
      clearInterval(heartbeat);
      server.off("upgrade", listener);
      await ctx.rooms.close();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
