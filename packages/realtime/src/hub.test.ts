import { type InboxItem, WS_CLOSE } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock.js";
import { Hub, type HubEvent, type HubJoin } from "./hub.js";
import { MemorySocket, MemoryTransport } from "./transport.js";
import { profile } from "./test-util.js";

function setup() {
  const clock = new ManualClock(50_000);
  const transport = new MemoryTransport();
  const events: HubEvent[] = [];
  const hub = new Hub({ transport, clock, onEvent: (e) => events.push(e) });
  const join = (key: string, extra: Partial<HubJoin> = {}) => {
    const socket = new MemorySocket(key);
    const res = hub.join(socket, {
      identityKey: key,
      owner: key.startsWith("owner:") ? key.slice(6) : null,
      room: "plaza",
      profile: profile(String(1000 + hub.sessionCount)),
      ...extra,
    });
    return { socket, res, session: res.ok ? res.session : null };
  };
  return { clock, transport, hub, join, events };
}

const item: InboxItem = {
  id: "n1",
  tokenId: "344030",
  createdAt: 1,
  readAt: null,
  kind: "mended",
  by: "65042",
  px: 3,
  toTargetMicro: 750_000,
  mode: "sim",
  region: null,
  batched: 0,
};

describe("Hub", () => {
  it("joins, fans out, and cleans up on leave", () => {
    const { hub, join } = setup();
    const a = join("guest:a");
    const b = join("guest:b");
    expect(a.socket.ofType("welcome")).toHaveLength(1);
    expect(a.socket.ofType("join")[0]?.[1].id).toBe(b.session?.entityId);
    b.session?.receive('["emote",1]');
    expect(a.socket.ofType("emote")).toEqual([["emote", b.session?.entityId, 1]]);
    expect(b.socket.ofType("emote")).toHaveLength(1);
    b.session?.leave();
    b.session?.leave();
    expect(a.socket.ofType("leave")).toEqual([["leave", b.session?.entityId]]);
    expect(hub.populations().plaza).toBe(1);
    a.session?.leave();
    expect(hub.roomCount).toBe(0);
  });

  it("refuses unknown rooms with a kick and close", () => {
    const { join } = setup();
    const x = join("guest:x", { room: "casino" });
    expect(x.res).toEqual({ ok: false, code: WS_CLOSE.badMessage, reason: "unknown room" });
    expect(x.socket.closed?.code).toBe(WS_CLOSE.badMessage);
  });

  it("keeps one presence per identity: the newer socket replaces the older one (4009)", () => {
    const { hub, join } = setup();
    const watcher = join("guest:w");
    const first = join("owner:0xabc");
    const second = join("owner:0xabc", { room: "sky-docks" });
    expect(first.socket.ofType("kick")).toEqual([["kick", WS_CLOSE.replaced]]);
    expect(first.socket.closed?.code).toBe(WS_CLOSE.replaced);
    expect(watcher.socket.ofType("leave")).toEqual([["leave", first.session?.entityId]]);
    first.session?.receive('["emote",1]'); // late frames from a replaced socket are ignored
    expect(watcher.socket.ofType("emote")).toEqual([]);
    expect(hub.directory.ownerRoute("0xABC")?.shard).toBe("room:sky-docks:0");
    expect(second.session?.room).toBe("sky-docks");
  });

  it("spawns arrivals on the bridge of the room they came from", () => {
    const { hub, join } = setup();
    const a = join("guest:a", { from: "sky-docks" });
    const me = hub.snapshot("room:plaza:0").find((e) => e.id === a.session?.entityId);
    expect(me).toMatchObject({ x: -1700, z: 0 });
  });

  it("honours ?shard= invites and fills shards in order", () => {
    const { join } = setup();
    expect(join("guest:i", { shard: 3 }).session?.shardId).toBe("room:plaza:3");
    expect(join("guest:j").session?.shardId).toBe("room:plaza:0");
  });

  it("refuses with 4029 once every shard is at the hard cap", () => {
    const clock = new ManualClock();
    const transport = new MemoryTransport();
    const hub = new Hub({ transport, clock, directory: { softCap: 1, hardCap: 2, maxShards: 1 } });
    const mk = (k: string) =>
      hub.join(new MemorySocket(), { identityKey: k, owner: null, room: "plaza", profile: profile() });
    expect(mk("a").ok).toBe(true);
    expect(mk("b").ok).toBe(true);
    expect(mk("c")).toMatchObject({ ok: false, code: WS_CLOSE.roomFull });
  });

  it("routes notify to the owner's socket only", () => {
    const { hub, join } = setup();
    const owner = join("owner:0xabc", { room: "seed-booth" });
    const other = join("guest:z", { room: "seed-booth" });
    expect(hub.notify("0xABC", item)).toBe(true);
    expect(owner.socket.ofType("notify")).toEqual([["notify", item]]);
    expect(other.socket.ofType("notify")).toEqual([]);
    owner.session?.leave();
    expect(hub.notify("0xabc", item)).toBe(false);
  });

  it("relays mended to the rooms of the target and the payer, and scars to the target's room", () => {
    const { hub, join } = setup();
    const target = join("owner:0x1", { room: "plaza", profile: profile("344030") });
    const payer = join("owner:0x2", { room: "sky-docks", profile: profile("65042") });
    const bystander = join("guest:b", { room: "daily-gate" });
    expect(hub.mended("344030", "65042", 3)).toBe(2);
    expect(target.socket.ofType("mended")).toEqual([["mended", "344030", "65042", 3]]);
    expect(payer.socket.ofType("mended")).toHaveLength(1);
    expect(bystander.socket.ofType("mended")).toEqual([]);
    hub.updateToken("344030", { scarsHash: "h9" });
    expect(target.socket.ofType("scars")).toEqual([["scars", "344030", "h9"]]);
    expect(payer.socket.ofType("scars")).toEqual([]);
  });

  it("kicks flooders through the transport and frees their slot", () => {
    const { hub, join, events } = setup();
    const a = join("guest:a");
    const b = join("guest:b");
    for (let i = 0; i < 5; i++) a.session?.receive('["say",1]');
    expect(a.socket.closed?.code).toBe(WS_CLOSE.rateLimited);
    expect(a.socket.ofType("kick")).toEqual([["kick", WS_CLOSE.rateLimited]]);
    expect(b.socket.ofType("leave")).toHaveLength(1);
    expect(hub.populations().plaza).toBe(1);
    expect(events.some((e) => e.type === "close" && e.code === WS_CLOSE.rateLimited)).toBe(true);
  });

  it("closes everything on shutdown", () => {
    const { hub, join } = setup();
    const a = join("guest:a");
    const b = join("guest:b", { room: "sky-docks" });
    hub.close();
    expect(a.socket.closed?.code).toBe(1001);
    expect(b.socket.closed?.code).toBe(1001);
    expect(hub.sessionCount).toBe(0);
    expect(hub.directory.populations().plaza).toBe(0);
  });
});
