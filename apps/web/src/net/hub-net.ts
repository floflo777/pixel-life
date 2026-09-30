/**
 * The hub scene's network port (`HubNet` from `@pl/game`, architecture §2.1) for the web shell:
 * - {@link createHubNet}: same-origin `/ws/room/:slug` over `@pl/realtime`'s `HubClient` (backoff, clock sync),
 *   authenticated by the session or guest cookie. `connect` resolves on `welcome` and rejects when the room refuses
 *   us or does not open in time, so the shell can fall back to the offline plaza instead of spinning forever.
 * - {@link createSwitchNet}: one stable `HubNet` for the scene whose transport can be swapped (online ⇄ offline)
 *   without rebuilding the scene.
 */
import type { HubNet, HubNetState } from "@pl/game";
import type { HubClient, HubClientState } from "@pl/realtime/client";
import { type RoomSlug, SERVER_MSG_TYPES, type ServerMsg } from "@pl/shared";

export type { HubNet, HubNetState };

/** Maps the realtime client's detailed state onto `HubNetState` (reconnecting shows as connecting). */
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

/** The socket URL of a room on `origin` (`http(s)` → `ws(s)`), with `?from=` when arriving over a bridge. */
export function roomSocketUrl(origin: string, room: RoomSlug, from: RoomSlug | null): string {
  const ws = origin.replace(/^http/, "ws").replace(/\/+$/, "");
  return `${ws}/ws/room/${room}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

/** Why a room could not be joined (the shell's error copy branches on `reason`). */
export class HubJoinError extends Error {
  constructor(
    readonly reason: "timeout" | "unauthorized" | "closed",
    message: string,
  ) {
    super(message);
    this.name = "HubJoinError";
  }
}

/** Options of {@link createHubNet}. */
export interface HubNetOptions {
  /** Page origin (default `location.origin`). */
  readonly origin?: string;
  /** A join that is not open by then is abandoned (default 8 s): the shell falls back to the offline plaza. */
  readonly openTimeoutMs?: number;
  /** Loads the client (tests inject a fake). Default: `@pl/realtime/client`, fetched on first connect. */
  readonly loadClient?: () => Promise<new (o: { url: (attempt: number) => string }) => HubClient>;
}

/** Online `HubNet`: a fresh `HubClient` per room. */
export function createHubNet(opts: HubNetOptions = {}): HubNet {
  const origin = opts.origin ?? location.origin;
  const openTimeoutMs = opts.openTimeoutMs ?? 8000;
  const load =
    opts.loadClient ??
    (async () =>
      (await import("@pl/realtime/client")).HubClient as unknown as new (o: {
        url: (attempt: number) => string;
      }) => HubClient);
  const listeners = new Set<(m: ServerMsg) => void>();
  let client: HubClient | null = null;
  const offs: (() => void)[] = [];
  let generation = 0;

  const drop = (): void => {
    generation++;
    for (const off of offs.splice(0)) off();
    const c = client;
    client = null;
    c?.close();
  };

  return {
    async connect(room, from = null) {
      drop();
      const mine = generation;
      const Client = await load();
      if (mine !== generation) throw new HubJoinError("closed", "superseded by a newer join");
      const c = new Client({ url: () => roomSocketUrl(origin, room, from) });
      client = c;
      for (const type of SERVER_MSG_TYPES)
        offs.push(
          c.on(type, (m) => {
            for (const l of listeners) l(m);
          }),
        );
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let offState = (): void => undefined;
        const settle = (e: HubJoinError | null): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          offState();
          if (!e) return resolve();
          // Stop the client's own reconnect loop: the shell decides what happens next (offline plaza, retry).
          if (client === c) drop();
          reject(e);
        };
        const timer = setTimeout(
          () => settle(new HubJoinError("timeout", "The sky did not answer in time.")),
          openTimeoutMs,
        );
        offState = c.onState((s) => {
          if (s.status === "open") settle(null);
          else if (s.status === "closed")
            settle(
              new HubJoinError(
                s.reason === "unauthorized" ? "unauthorized" : "closed",
                `The sky closed the door (${s.reason}).`,
              ),
            );
        });
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
      return client ? netState(client.state) : "idle";
    },
    close: drop,
    serverNow() {
      return client ? client.serverNow() : Date.now();
    },
  };
}

/** A `HubNet` whose transport can be swapped under a running scene. */
export interface SwitchNet extends HubNet {
  /** The transport in use. */
  readonly current: HubNet;
  /** Closes the current transport and routes everything through `next` from now on. */
  use(next: HubNet): void;
}

/** Wraps `initial` so the scene can keep one net while the shell swaps online ⇄ offline transports. */
export function createSwitchNet(initial: HubNet): SwitchNet {
  const listeners = new Set<(m: ServerMsg) => void>();
  let current = initial;
  const relay = (m: ServerMsg): void => {
    for (const l of listeners) l(m);
  };
  let off = current.on(relay);
  return {
    get current() {
      return current;
    },
    use(next) {
      if (next === current) return;
      off();
      current.close();
      current = next;
      off = current.on(relay);
    },
    connect: (room, from) => current.connect(room, from),
    send: (m) => current.send(m),
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    state: () => current.state(),
    close: () => current.close(),
    serverNow: () => current.serverNow(),
  };
}
