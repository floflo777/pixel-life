import type { HubClient, HubClientState } from "@pl/realtime/client";
import type { ClientMsg, ServerMsg } from "@pl/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHubNet, createSwitchNet, HubJoinError, netState, roomSocketUrl, type HubNet } from "./hub-net.js";

/** A scriptable stand-in for `HubClient`: tests drive its state and messages. */
class FakeClient {
  static last: FakeClient | null = null;
  state: HubClientState = { status: "idle" };
  readonly sent: ClientMsg[] = [];
  readonly url: string;
  closed = false;
  #state = new Set<(s: HubClientState) => void>();
  #msg = new Map<string, Set<(m: ServerMsg) => void>>();
  constructor(o: { url: (attempt: number) => string }) {
    this.url = o.url(0);
    FakeClient.last = this;
  }
  connect(): void {
    this.set({ status: "connecting", attempt: 0 });
  }
  close(): void {
    this.closed = true;
    this.set({ status: "closed", code: 1000, reason: "client" });
  }
  send(m: ClientMsg): boolean {
    this.sent.push(m);
    return true;
  }
  serverNow(): number {
    return 42;
  }
  onState(cb: (s: HubClientState) => void): () => void {
    this.#state.add(cb);
    return () => this.#state.delete(cb);
  }
  on(type: string, cb: (m: ServerMsg) => void): () => void {
    let set = this.#msg.get(type);
    if (!set) this.#msg.set(type, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }
  set(s: HubClientState): void {
    this.state = s;
    for (const cb of [...this.#state]) cb(s);
  }
  emit(m: ServerMsg): void {
    for (const cb of this.#msg.get(m[0]) ?? []) cb(m);
  }
}

const loadClient = async () => FakeClient as unknown as new (o: { url: (attempt: number) => string }) => HubClient;
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
  FakeClient.last = null;
});

describe("hub net helpers", () => {
  it("maps client states and builds room URLs", () => {
    expect(netState({ status: "reconnecting", attempt: 1, inMs: 500, lastCode: 1006 })).toBe("connecting");
    expect(netState({ status: "open" })).toBe("open");
    expect(roomSocketUrl("https://sky.example/", "plaza", null)).toBe("wss://sky.example/ws/room/plaza");
    expect(roomSocketUrl("http://localhost:5173", "seed-booth", "plaza")).toBe(
      "ws://localhost:5173/ws/room/seed-booth?from=plaza",
    );
  });
});

describe("createHubNet", () => {
  it("resolves on open, relays messages, sends, and reports the server clock", async () => {
    const net = createHubNet({ origin: "https://sky.example", loadClient });
    const got: ServerMsg[] = [];
    net.on((m) => got.push(m));
    const joined = net.connect("plaza", null);
    await flush();
    const c = FakeClient.last as FakeClient;
    expect(c.url).toBe("wss://sky.example/ws/room/plaza");
    expect(net.state()).toBe("connecting");
    c.set({ status: "open" });
    await joined;
    expect(net.state()).toBe("open");
    c.emit(["leave", "e1"]);
    expect(got).toEqual([["leave", "e1"]]);
    net.send(["emote", 2]);
    expect(c.sent).toEqual([["emote", 2]]);
    expect(net.serverNow()).toBe(42);
    net.close();
    expect(c.closed).toBe(true);
    expect(net.state()).toBe("idle");
  });

  it("rejects with `unauthorized` when the room closes the door, and stops the client", async () => {
    const net = createHubNet({ origin: "https://sky.example", loadClient });
    const joined = net.connect("plaza", null);
    await flush();
    const c = FakeClient.last as FakeClient;
    c.set({ status: "closed", code: 4001, reason: "unauthorized" });
    await expect(joined).rejects.toMatchObject({ reason: "unauthorized" });
    expect(c.closed).toBe(true);
  });

  it("gives up after the open timeout instead of reconnecting forever", async () => {
    vi.useFakeTimers();
    const net = createHubNet({ origin: "https://sky.example", openTimeoutMs: 1000, loadClient });
    const joined = net.connect("plaza", null);
    await vi.advanceTimersByTimeAsync(0);
    const c = FakeClient.last as FakeClient;
    c.set({ status: "reconnecting", attempt: 1, inMs: 500, lastCode: 1006 });
    const caught = joined.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1000);
    const e = await caught;
    expect(e).toBeInstanceOf(HubJoinError);
    expect((e as HubJoinError).reason).toBe("timeout");
    expect(c.closed).toBe(true);
  });
});

describe("createSwitchNet", () => {
  const fake = (
    name: string,
  ): HubNet & { listeners: Set<(m: ServerMsg) => void>; closed: number; sent: ClientMsg[] } => {
    const listeners = new Set<(m: ServerMsg) => void>();
    const o = {
      listeners,
      closed: 0,
      sent: [] as ClientMsg[],
      connect: vi.fn(async () => undefined),
      send: (m: ClientMsg) => void o.sent.push(m),
      on: (cb: (m: ServerMsg) => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      state: () => (name === "a" ? ("open" as const) : ("connecting" as const)),
      close: () => void o.closed++,
      serverNow: () => (name === "a" ? 1 : 2),
    };
    return o;
  };

  it("keeps one listener set for the scene while the transport is swapped", async () => {
    const a = fake("a");
    const b = fake("b");
    const net = createSwitchNet(a);
    const got: ServerMsg[] = [];
    net.on((m) => got.push(m));
    for (const l of a.listeners) l(["leave", "x"]);
    expect(net.state()).toBe("open");
    net.use(b);
    expect(a.closed).toBe(1);
    expect(a.listeners.size).toBe(0);
    for (const l of b.listeners) l(["leave", "y"]);
    expect(got).toEqual([
      ["leave", "x"],
      ["leave", "y"],
    ]);
    await net.connect("plaza", null);
    expect(b.connect).toHaveBeenCalledWith("plaza", null);
    net.send(["emote", 1]);
    expect(b.sent).toEqual([["emote", 1]]);
    expect(net.serverNow()).toBe(2);
    expect(net.current).toBe(b);
  });
});
