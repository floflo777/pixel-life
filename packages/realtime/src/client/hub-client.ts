import { type ClientMsg, decodeServerFrame, encodeMsg, type ServerMsg, type ServerMsgType, WS_CLOSE } from "@pl/shared";
import { ClockSync } from "./clock-sync.js";
import { type EntitySample, INTERPOLATION_DELAY_MS, PresenceBuffer } from "./interpolation.js";

/** Minimal browser WebSocket surface the client uses (injectable for tests). */
export interface ClientSocket {
  readonly readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Constructor of {@link ClientSocket}s (the global `WebSocket` by default). */
export type ClientSocketCtor = new (url: string) => ClientSocket;

/** Timer functions (injectable so tests can drive time). */
export interface ClientTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Connection lifecycle as shown to the UI (loading / error / retry states). */
export type HubClientState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "open" }
  | { status: "reconnecting"; attempt: number; inMs: number; lastCode: number }
  | { status: "closed"; code: number; reason: "client" | "kicked" | "unauthorized" | "replaced" | "bad-message" };

/** Options for {@link HubClient}. */
export interface HubClientOptions {
  /** Socket URL, or a factory called on every (re)connect (e.g. to drop a `?shard=` invite after a 4029). */
  readonly url: string | ((attempt: number) => string);
  readonly WebSocket?: ClientSocketCtor;
  /** Local monotonic clock in ms (default `performance.now`). */
  readonly now?: () => number;
  readonly timers?: ClientTimers;
  /** [0, 1) random source for backoff jitter. */
  readonly random?: () => number;
  readonly backoff?: { readonly initialMs?: number; readonly maxMs?: number; readonly factor?: number };
  /** Clock-sync ping period; stays under the server's 1/s ping bucket. */
  readonly pingIntervalMs?: number;
  /** A ping without pong for this long is abandoned (a new one may be sent). */
  readonly pingTimeoutMs?: number;
  readonly interpolationDelayMs?: number;
}

type Handler<T extends ServerMsgType> = (msg: Extract<ServerMsg, [T, ...unknown[]]>) => void;
type AnyHandler = (msg: ServerMsg) => void;

/** Pings sent at {@link FAST_PING_MS} right after joining, before settling to the steady period. */
const FAST_PINGS = 5;
/** Just over the server's 1 ping/s refill. */
const FAST_PING_MS = 1100;

/** Close codes after which reconnecting cannot help: the app must re-authenticate or the user chose another tab. */
const TERMINAL: Readonly<Record<number, Extract<HubClientState, { status: "closed" }>["reason"]>> = {
  [WS_CLOSE.unauthorized]: "unauthorized",
  [WS_CLOSE.notOwner]: "unauthorized",
  [WS_CLOSE.replaced]: "replaced",
  [WS_CLOSE.badMessage]: "bad-message",
};

/**
 * Browser hub client: connects with exponential backoff + jitter, dispatches typed server messages, keeps a
 * server-clock estimate via ping/pong, and maintains a {@link PresenceBuffer} for smooth per-entity positions.
 */
export class HubClient {
  readonly clock = new ClockSync();
  readonly presence: PresenceBuffer;
  readonly #o: HubClientOptions;
  readonly #now: () => number;
  readonly #timers: ClientTimers;
  readonly #random: () => number;
  readonly #handlers = new Map<ServerMsgType, Set<AnyHandler>>();
  readonly #stateHandlers = new Set<(s: HubClientState) => void>();
  #socket: ClientSocket | null = null;
  #state: HubClientState = { status: "idle" };
  #attempt = 0;
  #retryTimer: unknown = null;
  #pingTimer: unknown = null;
  #pingSentAt: number | null = null;
  #kickCode: number | null = null;
  #wanted = false;
  #seq = 0;
  #pingsSent = 0;

  /** Creates an idle client; call {@link connect}. */
  constructor(options: HubClientOptions) {
    this.#o = options;
    this.#now = options.now ?? (() => performance.now());
    this.#timers = options.timers ?? {
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
    };
    this.#random = options.random ?? Math.random;
    this.presence = new PresenceBuffer();
  }

  /** Current lifecycle state. */
  get state(): HubClientState {
    return this.#state;
  }

  /** Opens the connection (no-op when already connecting or open). */
  connect(): void {
    this.#wanted = true;
    if (this.#socket || this.#retryTimer !== null) return;
    this.#open();
  }

  /** Closes for good (no reconnect). */
  close(): void {
    this.#wanted = false;
    this.#clearTimers();
    const s = this.#socket;
    this.#socket = null;
    if (s) {
      s.onclose = null;
      s.close(1000, "client closed");
    }
    this.#setState({ status: "closed", code: 1000, reason: "client" });
  }

  /** Sends a message when open; returns false (dropped) otherwise. Presence input is never queued: stale moves are worse than none. */
  send(msg: ClientMsg): boolean {
    const s = this.#socket;
    if (!s || s.readyState !== 1 || this.#state.status !== "open") return false;
    s.send(encodeMsg(msg));
    return true;
  }

  /** Sends a click-to-move with an increasing sequence number. */
  move(x: number, z: number): boolean {
    this.#seq = (this.#seq + 1) >>> 0;
    return this.send(["move", this.#seq, Math.round(x), Math.round(z)]);
  }

  /** Subscribes to one server message type; returns an unsubscribe function. */
  on<T extends ServerMsgType>(type: T, handler: Handler<T>): () => void {
    let set = this.#handlers.get(type);
    if (!set) {
      set = new Set();
      this.#handlers.set(type, set);
    }
    const h = handler as AnyHandler;
    set.add(h);
    return () => set.delete(h);
  }

  /** Subscribes to lifecycle changes (called immediately with the current state). */
  onState(handler: (s: HubClientState) => void): () => void {
    this.#stateHandlers.add(handler);
    handler(this.#state);
    return () => this.#stateHandlers.delete(handler);
  }

  /** Estimated current server time. */
  serverNow(): number {
    return this.clock.serverNow(this.#now());
  }

  /** Server time the renderer should draw (behind real time by the interpolation delay). */
  renderTime(): number {
    return this.serverNow() - (this.#o.interpolationDelayMs ?? INTERPOLATION_DELAY_MS);
  }

  /** Smooth position of one entity for this frame. */
  sample(id: string, t = this.renderTime()): EntitySample | undefined {
    return this.presence.sample(id, t);
  }

  #open(): void {
    const Ctor = this.#o.WebSocket ?? (globalThis.WebSocket as unknown as ClientSocketCtor | undefined);
    if (!Ctor) throw new Error("No WebSocket implementation available.");
    this.#setState({ status: "connecting", attempt: this.#attempt });
    const url = typeof this.#o.url === "function" ? this.#o.url(this.#attempt) : this.#o.url;
    this.#kickCode = null;
    let socket: ClientSocket;
    try {
      socket = new Ctor(url);
    } catch {
      this.#scheduleReconnect(1006);
      return;
    }
    this.#socket = socket;
    socket.onmessage = (ev) => {
      if (typeof ev.data === "string") this.#onFrame(ev.data);
    };
    socket.onclose = (ev) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#clearPing();
      this.#onClosed(this.#kickCode ?? ev.code);
    };
    socket.onerror = () => {
      // A close event always follows; reconnect logic lives there.
    };
  }

  #onFrame(frame: string): void {
    const msg = decodeServerFrame(frame);
    if (!msg) return;
    const now = this.#now();
    switch (msg[0]) {
      case "welcome":
        // Only a welcome proves the room accepted us, so backoff resets here rather than on socket open.
        this.#attempt = 0;
        this.clock.reset();
        this.clock.seed(msg[3], now);
        this.#setState({ status: "open" });
        this.#clearPing();
        this.#schedulePing(0);
        break;
      case "pong":
        if (this.#pingSentAt !== null) this.clock.addSample(this.#pingSentAt, msg[1], now);
        this.#pingSentAt = null;
        break;
      case "kick":
        this.#kickCode = msg[1];
        break;
      default:
        break;
    }
    this.presence.apply(msg);
    const set = this.#handlers.get(msg[0]);
    if (set) for (const h of set) h(msg);
  }

  #onClosed(code: number): void {
    const terminal = TERMINAL[code];
    if (!this.#wanted) return;
    if (terminal) {
      this.#wanted = false;
      this.#setState({ status: "closed", code, reason: terminal });
      return;
    }
    this.#scheduleReconnect(code);
  }

  #scheduleReconnect(code: number): void {
    const b = this.#o.backoff ?? {};
    const initial = b.initialMs ?? 500;
    const max = b.maxMs ?? 15_000;
    const factor = b.factor ?? 2;
    this.#attempt++;
    // Kicked for flooding: wait the full cap so a buggy client cannot hammer the server.
    const base = code === WS_CLOSE.rateLimited ? max : Math.min(max, initial * factor ** (this.#attempt - 1));
    const inMs = Math.round(base * (0.7 + 0.6 * this.#random()));
    this.#setState({ status: "reconnecting", attempt: this.#attempt, inMs, lastCode: code });
    this.#retryTimer = this.#timers.setTimeout(() => {
      this.#retryTimer = null;
      if (this.#wanted) this.#open();
    }, inMs);
  }

  #schedulePing(inMs: number): void {
    if (this.#pingTimer !== null) this.#timers.clearTimeout(this.#pingTimer);
    this.#pingTimer = this.#timers.setTimeout(() => {
      this.#pingTimer = null;
      const timeout = this.#o.pingTimeoutMs ?? 5000;
      const now = this.#now();
      // One ping in flight at a time: `pong` carries only the server time, so pairing relies on it.
      if (this.#pingSentAt === null || now - this.#pingSentAt > timeout) {
        this.#pingSentAt = now;
        if (this.send(["ping", Math.max(0, Math.round(now))])) this.#pingsSent++;
        else this.#pingSentAt = null;
      }
      // A quick burst first so the estimate converges, then the steady period (both under the 1/s bucket).
      const steady = this.#o.pingIntervalMs ?? 5000;
      this.#schedulePing(this.#pingsSent < FAST_PINGS ? FAST_PING_MS : steady);
    }, inMs);
  }

  #clearPing(): void {
    if (this.#pingTimer !== null) this.#timers.clearTimeout(this.#pingTimer);
    this.#pingTimer = null;
    this.#pingSentAt = null;
    this.#pingsSent = 0;
  }

  #clearTimers(): void {
    this.#clearPing();
    if (this.#retryTimer !== null) this.#timers.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #setState(s: HubClientState): void {
    this.#state = s;
    for (const h of this.#stateHandlers) h(s);
  }
}
