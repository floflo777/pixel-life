/**
 * `HubNet` (architecture §2.1): the hub scene's network port, implemented over `@pl/realtime`'s `HubClient`
 * (reconnect with backoff, clock sync, interpolation). Same-origin `/ws/room/:slug`, authenticated by the session or
 * guest cookie.
 */
import type { HubClient, HubClientState } from "@pl/realtime/client";
import { type ClientMsg, type RoomSlug, SERVER_MSG_TYPES, type ServerMsg } from "@pl/shared";

/** Connection state as the hub sees it. */
export type HubNetState = "idle" | "connecting" | "open" | "closed";

/** The network port handed to `createHubScene`. */
export interface HubNet {
  connect(room: RoomSlug): Promise<void>;
  send(m: ClientMsg): void;
  on(cb: (m: ServerMsg) => void): () => void;
  state(): HubNetState;
  onState(cb: (s: HubNetState) => void): () => void;
  /** The underlying client once connected (interpolated presence, server clock). */
  client(): HubClient | null;
  close(): void;
}

/** Maps the realtime client's detailed state onto `HubNetState`. */
export function netState(s: HubClientState): HubNetState {
  switch (s.status) {
    case "idle":
      return "idle";
    case "open":
      return "open";
    case "closed":
      return "closed";
    default:
      return "connecting";
  }
}

/** Creates a `HubNet` for `origin` (default: this page). `HubClient` is loaded on first connect. */
export function createHubNet(origin: string = location.origin): HubNet {
  let client: HubClient | null = null;
  const listeners = new Set<(m: ServerMsg) => void>();
  const stateListeners = new Set<(s: HubNetState) => void>();
  const offs: (() => void)[] = [];
  let current: HubNetState = "idle";
  const setState = (s: HubNetState): void => {
    if (s === current) return;
    current = s;
    for (const cb of [...stateListeners]) cb(s);
  };

  return {
    async connect(room) {
      this.close();
      const { HubClient: Client } = await import("@pl/realtime/client");
      const ws = origin.replace(/^http/, "ws");
      const c = new Client({ url: `${ws}/ws/room/${room}` });
      client = c;
      for (const type of SERVER_MSG_TYPES) {
        offs.push(c.on(type, (m) => listeners.forEach((cb) => cb(m))));
      }
      offs.push(c.onState((s) => setState(netState(s))));
      c.connect();
      setState(netState(c.state));
    },
    send(m) {
      client?.send(m);
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    state: () => current,
    onState(cb) {
      stateListeners.add(cb);
      return () => stateListeners.delete(cb);
    },
    client: () => client,
    close() {
      for (const off of offs.splice(0)) off();
      client?.close();
      client = null;
      setState("idle");
    },
  };
}
