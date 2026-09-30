import { encodeMsg, type PresenceEntity, type ServerMsg, WS_CLOSE } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { ClockSync } from "./clock-sync.js";
import { type ClientSocket, HubClient, type HubClientState } from "./hub-client.js";

/** Deterministic timers + clock. */
class FakeTime {
  now = 0;
  #seq = 0;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.#seq;
    this.#timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (h: unknown): void => void this.#timers.delete(h as number);
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.#timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.#timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = end;
  }
}

class FakeSocket implements ClientSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code = 1000): void {
    this.serverClose(code);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  deliver(msg: ServerMsg): void {
    this.onmessage?.({ data: encodeMsg(msg) } as MessageEvent);
  }
  serverClose(code: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

const me: PresenceEntity = {
  id: "e1",
  kind: "guest",
  tokenId: "65042",
  loaned: true,
  x: 0,
  z: 0,
  venue: null,
  scarsHash: "h",
  goldHeld: 0,
};

function setup(url: string | ((a: number) => string) = "wss://hub/ws/room/plaza") {
  FakeSocket.all = [];
  const time = new FakeTime();
  const states: HubClientState[] = [];
  const client = new HubClient({
    url,
    WebSocket: FakeSocket,
    now: () => time.now,
    timers: time,
    random: () => 0.5,
    backoff: { initialMs: 500, maxMs: 8000 },
  });
  client.onState((s) => states.push(s));
  const last = () => FakeSocket.all.at(-1) as FakeSocket;
  return { client, time, states, last };
}

describe("HubClient", () => {
  it("connects, becomes open on welcome, dispatches typed messages and sends only while open", () => {
    const { client, last } = setup();
    expect(client.send(["emote", 1])).toBe(false);
    client.connect();
    expect(client.state.status).toBe("connecting");
    last().open();
    const emotes: number[] = [];
    client.on("emote", (m) => emotes.push(m[2]));
    last().deliver(["welcome", "e1", [me], 1_000_000]);
    expect(client.state).toEqual({ status: "open" });
    last().deliver(["emote", "e1", 4]);
    expect(emotes).toEqual([4]);
    expect(client.move(120.4, -30)).toBe(true);
    expect(client.move(10, 10)).toBe(true);
    expect(last().sent.filter((f) => f.startsWith('["move"'))).toEqual(['["move",1,120,-30]', '["move",2,10,10]']);
    expect(client.presence.you).toBe("e1");
  });

  it("reconnects with exponential backoff and resets it after a welcome", () => {
    const { client, time, states, last } = setup();
    client.connect();
    last().serverClose(1006);
    expect(states.at(-1)).toEqual({ status: "reconnecting", attempt: 1, inMs: 500, lastCode: 1006 });
    time.advance(500);
    expect(FakeSocket.all).toHaveLength(2);
    last().serverClose(1006);
    expect(states.at(-1)).toMatchObject({ attempt: 2, inMs: 1000 });
    time.advance(1000);
    last().serverClose(1006);
    time.advance(2000);
    last().serverClose(1006);
    time.advance(4000);
    last().serverClose(1006);
    expect(states.at(-1)).toMatchObject({ attempt: 5, inMs: 8000 }); // capped
    time.advance(8000);
    last().open();
    last().deliver(["welcome", "e1", [me], 0]);
    last().serverClose(1006);
    expect(states.at(-1)).toMatchObject({ attempt: 1, inMs: 500 });
  });

  it("stops for good when replaced by another tab or unauthorized", () => {
    for (const [code, reason] of [
      [WS_CLOSE.replaced, "replaced"],
      [WS_CLOSE.unauthorized, "unauthorized"],
    ] as const) {
      const { client, time, last } = setup();
      client.connect();
      last().open();
      last().deliver(["kick", code]);
      last().serverClose(1000); // the kick code wins over whatever the close frame says
      expect(client.state).toEqual({ status: "closed", code, reason });
      time.advance(60_000);
      expect(FakeSocket.all).toHaveLength(1);
    }
  });

  it("waits the full backoff cap after a rate-limit kick", () => {
    const { client, states, last } = setup();
    client.connect();
    last().open();
    last().deliver(["kick", WS_CLOSE.rateLimited]);
    last().serverClose(WS_CLOSE.rateLimited);
    expect(states.at(-1)).toMatchObject({ status: "reconnecting", inMs: 8000, lastCode: WS_CLOSE.rateLimited });
  });

  it("asks the URL factory again on each attempt (e.g. drop a full invite shard)", () => {
    const { client, time, last } = setup((a) =>
      a === 0 ? "wss://hub/ws/room/plaza?shard=3" : "wss://hub/ws/room/plaza",
    );
    client.connect();
    expect(last().url).toContain("shard=3");
    last().serverClose(WS_CLOSE.roomFull);
    time.advance(500);
    expect(last().url).not.toContain("shard");
  });

  it("close() is final and silences the socket", () => {
    const { client, time, last } = setup();
    client.connect();
    last().open();
    client.close();
    expect(client.state).toMatchObject({ status: "closed", reason: "client" });
    time.advance(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("syncs the server clock with ping/pong within the 1/s ping budget", () => {
    const { client, time, last } = setup();
    const OFFSET = 5_000_000; // server clock = local + 5e6
    const LATENCY = 40; // one way
    client.connect();
    last().open();
    last().deliver(["welcome", "e1", [me], time.now + OFFSET - LATENCY]);
    const pingTimes: number[] = [];
    for (let i = 0; i < 40; i++) {
      time.advance(100);
      const s = last();
      const pending = s.sent.filter((f) => f.startsWith('["ping"'));
      if (pending.length > pingTimes.length) {
        pingTimes.push(time.now);
        // Answer after the one-way latency, stamping the server clock at the midpoint.
        time.advance(LATENCY);
        s.deliver(["pong", time.now - LATENCY + OFFSET]);
        time.advance(LATENCY);
      }
    }
    for (let i = 1; i < pingTimes.length; i++)
      expect((pingTimes[i] as number) - (pingTimes[i - 1] as number)).toBeGreaterThanOrEqual(1000);
    expect(pingTimes.length).toBeGreaterThanOrEqual(3);
    time.advance(10_000); // let the slewed estimate converge
    expect(Math.abs(client.serverNow() - (time.now + OFFSET))).toBeLessThan(5);
    expect(client.clock.rtt).toBe(2 * LATENCY);
  });
});

describe("ClockSync", () => {
  it("prefers the lowest-RTT sample and slews instead of stepping", () => {
    const c = new ClockSync();
    c.seed(1000, 0); // offset 1000
    expect(c.serverNow(0)).toBe(1000);
    c.addSample(100, 1200, 300); // rtt 200, offset 1200 − 200 = 1000
    c.addSample(400, 1560, 420); // rtt 20, offset 1560 − 410 = 1150
    // 150 ms off: slewed at 0.1 ms/ms rather than jumping.
    expect(c.serverNow(430)).toBeCloseTo(430 + 1001, 0);
    expect(c.serverNow(3000)).toBe(3000 + 1150);
  });

  it("snaps when far off (first sync after a server restart)", () => {
    const c = new ClockSync();
    c.seed(0, 0);
    c.addSample(0, 10_000, 10);
    expect(c.serverNow(10)).toBe(10 + 9995);
  });
});
