/**
 * `HubNet` (architecture §2.1): the only network surface the hub scene sees. Two adapters: over the browser
 * `HubClient` (WebSocket, backoff, clock sync) and over an in-memory `@pl/realtime` Hub (offline single-player plaza,
 * the dev page and tests). The scene keeps its own interpolation buffer, so both look identical to it.
 */
import {
  type ClientMsg,
  decodeServerFrame,
  encodeMsg,
  type RoomSlug,
  SERVER_MSG_TYPES,
  type ServerMsg,
} from "@pl/shared";
import { Hub, type HubJoin, type HubOptions, type HubSession, type RoomTransport } from "@pl/realtime";
import { HubClient, type HubClientOptions } from "@pl/realtime/client";

/** Connection state as the scene shows it. */
export type HubNetState = "idle" | "connecting" | "open" | "closed";

/** The hub scene's network port: one room at a time. */
export interface HubNet {
  /** Joins `room` (leaving any current one), arriving from `from` when walking over a bridge. Resolves on `welcome`. */
  connect(room: RoomSlug, from?: RoomSlug | null): Promise<void>;
  /** Sends a client message (dropped while not open: stale presence input is worse than none). */
  send(m: ClientMsg): void;
  /** Subscribes to every server message; returns an unsubscribe. */
  on(cb: (m: ServerMsg) => void): () => void;
  state(): HubNetState;
  close(): void;
  /** Current server time estimate (ms, same base as `moved.t0`). */
  serverNow(): number;
}

/** Options of {@link hubNetFromClient}. */
export interface HubClientNetOptions extends Omit<HubClientOptions, "url"> {
  /** Socket URL for a room (e.g. `/ws/room/plaza?from=sky-docks`); `attempt` counts reconnects. */
  readonly url: (room: RoomSlug, from: RoomSlug | null, attempt: number) => string;
}

/** `HubNet` over a fresh {@link HubClient} per room (reconnects and clock sync come from the client). */
export function hubNetFromClient(opts: HubClientNetOptions): HubNet {
  const listeners = new Set<(m: ServerMsg) => void>();
  let client: HubClient | null = null;
  let offs: (() => void)[] = [];
  const drop = (): void => {
    for (const o of offs) o();
    offs = [];
    client?.close();
    client = null;
  };
  return {
    connect(room, from = null) {
      drop();
      const { url, ...rest } = opts;
      const c = new HubClient({ ...rest, url: (attempt) => url(room, from, attempt) });
      client = c;
      for (const t of SERVER_MSG_TYPES)
        offs.push(
          c.on(t, (m) => {
            for (const l of listeners) l(m);
          }),
        );
      return new Promise<void>((resolve, reject) => {
        const off = c.onState((s) => {
          if (s.status === "open") {
            queueMicrotask(off);
            resolve();
          } else if (s.status === "closed") {
            queueMicrotask(off);
            reject(new Error(`hub closed: ${s.reason} (${s.code})`));
          }
        });
        offs.push(off);
        c.connect();
      });
    },
    send(m) {
      client?.send(m);
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    state() {
      const s = client?.state.status ?? "idle";
      if (s === "reconnecting") return "connecting";
      return s;
    },
    close: drop,
    serverNow() {
      return client ? client.serverNow() : Date.now();
    },
  };
}

/** A socket end inside the in-memory hub: frames arrive asynchronously, like a network. */
export class LocalSocket {
  onFrame: ((frame: string) => void) | null = null;
  onClose: ((code: number) => void) | null = null;
  closed: { code: number; reason: string } | null = null;
}

/** Transport that hands frames to {@link LocalSocket}s on the microtask queue (no re-entrancy into the room). */
export function localTransport(): RoomTransport<LocalSocket> {
  return {
    send(s, frame) {
      if (s.closed) return;
      queueMicrotask(() => s.onFrame?.(frame));
    },
    close(s, code, reason) {
      if (s.closed) return;
      s.closed = { code, reason };
      queueMicrotask(() => s.onClose?.(code));
    },
  };
}

/** An in-memory hub with every D-09 room (the offline plaza and the dev page's server). */
export function createLocalHub(opts: Omit<HubOptions<LocalSocket>, "transport"> = {}): Hub<LocalSocket> {
  return new Hub<LocalSocket>({ ...opts, transport: localTransport() });
}

/** Who joins through a local net. */
export type LocalJoin = Omit<HubJoin, "room" | "from" | "shard">;

/** `HubNet` over an in-memory {@link Hub}. `now` must be the hub's clock (default `Date.now`, the hub default). */
export function createLocalHubNet(hub: Hub<LocalSocket>, join: LocalJoin, now: () => number = Date.now): HubNet {
  const listeners = new Set<(m: ServerMsg) => void>();
  let session: HubSession | null = null;
  let socket: LocalSocket | null = null;
  let status: HubNetState = "idle";
  const leave = (): void => {
    if (socket) socket.onFrame = socket.onClose = null;
    session?.leave();
    session = null;
    socket = null;
  };
  return {
    connect(room, from = null) {
      leave();
      status = "connecting";
      const s = new LocalSocket();
      socket = s;
      return new Promise<void>((resolve, reject) => {
        s.onFrame = (frame) => {
          const m = decodeServerFrame(frame);
          if (!m) return;
          if (m[0] === "welcome") {
            status = "open";
            resolve();
          }
          for (const l of listeners) l(m);
        };
        s.onClose = (code) => {
          status = "closed";
          reject(new Error(`hub closed (${code})`));
        };
        const r = hub.join(s, { ...join, room, from });
        if (r.ok) session = r.session;
      });
    },
    send(m) {
      if (status === "open") session?.receive(encodeMsg(m));
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    state: () => status,
    close() {
      leave();
      status = "closed";
    },
    serverNow: now,
  };
}
