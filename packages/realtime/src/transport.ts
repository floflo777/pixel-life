import { decodeServerFrame, type ServerMsg } from "@pl/shared";

/**
 * What the realtime layer needs from a socket implementation. The server implements it over `ws`; tests use
 * {@link MemoryTransport}. Both calls must not throw: a failed send is the transport's problem (it may close).
 */
export interface RoomTransport<S> {
  /** Delivers one already-encoded text frame. */
  send(socket: S, frame: string): void;
  /** Closes the socket with an application close code (4000-4999) or a standard one (1001 on shutdown). */
  close(socket: S, code: number, reason: string): void;
}

/** Structural subset of a `ws` / browser WebSocket that {@link socketTransport} drives. */
export interface WsLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** `WebSocket.OPEN`. */
const OPEN = 1;
/** Standard "try again later" close: the client could not keep up with the room's fan-out. */
export const CLOSE_SLOW_CONSUMER = 1013;

/**
 * Ready-made transport for `ws` sockets: drops frames to sockets that are not open, and closes a socket whose send
 * buffer exceeds `maxBufferedBytes` (a stalled phone must not grow server memory without bound).
 */
export function socketTransport<S extends WsLike>(maxBufferedBytes = 1 << 20): RoomTransport<S> {
  return {
    send(socket, frame) {
      if (socket.readyState !== OPEN) return;
      if (socket.bufferedAmount > maxBufferedBytes) {
        socket.close(CLOSE_SLOW_CONSUMER, "slow consumer");
        return;
      }
      socket.send(frame);
    },
    close(socket, code, reason) {
      if (socket.readyState <= OPEN) socket.close(code, reason);
    },
  };
}

/** A fake socket that records what the realtime layer sent it. */
export class MemorySocket {
  /** Frames received, in order (empty when the transport does not record). */
  readonly frames: string[] = [];
  /** Frames received, counted even when not recorded. */
  received = 0;
  /** Close code and reason once closed. */
  closed: { code: number; reason: string } | null = null;

  /** Creates a socket labelled `label` (test diagnostics only). */
  constructor(readonly label = "") {}

  /** Recorded frames decoded as server messages. */
  messages(): ServerMsg[] {
    return this.frames.map((f) => decodeServerFrame(f)).filter((m): m is ServerMsg => m !== null);
  }

  /** Recorded messages of one type. */
  ofType<T extends ServerMsg[0]>(type: T): Extract<ServerMsg, [T, ...unknown[]]>[] {
    return this.messages().filter((m): m is Extract<ServerMsg, [T, ...unknown[]]> => m[0] === type);
  }

  /** Forgets recorded frames. */
  clear(): void {
    this.frames.length = 0;
  }
}

/** In-memory transport for tests and load simulations; counts every frame and close. */
export class MemoryTransport implements RoomTransport<MemorySocket> {
  /** Total frames sent through this transport. */
  sent = 0;
  /** Total closes. */
  closes = 0;

  /** With `record: false` frames are only counted (for large load tests). */
  constructor(readonly options: { record?: boolean } = {}) {}

  /** Records a frame unless the socket is closed. */
  send(socket: MemorySocket, frame: string): void {
    if (socket.closed) return;
    this.sent++;
    socket.received++;
    if (this.options.record !== false) socket.frames.push(frame);
  }

  /** Marks the socket closed (first close wins). */
  close(socket: MemorySocket, code: number, reason: string): void {
    if (socket.closed) return;
    this.closes++;
    socket.closed = { code, reason };
  }
}
