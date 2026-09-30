import { type ServerMsg, WS_CLOSE } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock.js";
import { rect } from "./geometry.js";
import { HUB_WALK_SPEED, MAX_MOVE_DISTANCE } from "./motion.js";
import { Navmesh } from "./navmesh.js";
import { type Outbound, Room, type RoomOptions } from "./room.js";
import { profile } from "./test-util.js";

const mesh = new Navmesh({
  room: "plaza",
  version: 1,
  areas: [rect(-20000, -20000, 20000, 20000)],
  holes: [rect(1000, -500, 1200, 500)],
  spawns: [[0, 0]],
  doors: [],
  landmarks: [],
});

function makeRoom(extra: Partial<RoomOptions> = {}) {
  const clock = new ManualClock(10_000);
  let n = 0;
  const room = new Room({
    slug: "plaza",
    shard: 0,
    walkable: mesh,
    clock,
    spawns: [[0, 0]],
    arrivals: { "pixel-arena": [-500, -500] },
    nextEntityId: () => `e${++n}`,
    ...extra,
  });
  return { room, clock };
}

const msgs = (out: Outbound[]): ServerMsg[] => out.flatMap((o) => (o.kind === "close" ? [] : [o.msg]));

describe("Room join / leave", () => {
  it("welcomes the joiner with the roster and announces it to others", () => {
    const { room } = makeRoom();
    const a = room.join("a", profile("1"));
    expect(a?.out[0]).toEqual({ kind: "send", conn: "a", msg: ["welcome", "e1", expect.any(Array), 10_000] });
    const b = room.join("b", profile("2"), { from: "pixel-arena" });
    const welcome = b?.out[0];
    expect(welcome?.kind === "send" && welcome.msg[0] === "welcome" && welcome.msg[2].map((e) => e.id)).toEqual([
      "e1",
      "e2",
    ]);
    const join = b?.out.find((o) => o.kind === "broadcast");
    expect(join).toMatchObject({ except: "b", msg: ["join", { id: "e2", tokenId: "2", x: -500, z: -500 }] });
    expect(room.leave("b")).toEqual([{ kind: "broadcast", except: null, msg: ["leave", "e2"] }]);
    expect(room.leave("b")).toEqual([]);
  });

  it("refuses joins beyond the hard cap", () => {
    const { room } = makeRoom({ hardCap: 2 });
    expect(room.join("a", profile("1"))).not.toBeNull();
    expect(room.join("b", profile("2"))).not.toBeNull();
    expect(room.join("c", profile("3"))).toBeNull();
  });

  it("replays in-flight walks to a late joiner", () => {
    const { room, clock } = makeRoom();
    room.join("a", profile("1"));
    room.handle("a", ["move", 1, 0, 6000]);
    clock.advance(1000);
    const out = room.join("b", profile("2"))?.out ?? [];
    const welcome = out[0];
    expect(welcome?.kind === "send" && welcome.msg[0] === "welcome" && welcome.msg[2][0]).toMatchObject({
      x: 0,
      z: HUB_WALK_SPEED,
    });
    expect(msgs(out)).toContainEqual(["moved", "e1", 0, 0, 0, 6000, 10_000]);
  });
});

describe("Room movement", () => {
  it("broadcasts server-timed walks from the current interpolated position", () => {
    const { room, clock } = makeRoom();
    room.join("a", profile());
    expect(msgs(room.handle("a", ["move", 1, 0, 2400]))).toEqual([["moved", "e1", 0, 0, 0, 2400, 10_000]]);
    clock.advance(1000); // 12 u/s → 1200 cm travelled
    expect(msgs(room.handle("a", ["move", 2, -600, 1200]))).toEqual([["moved", "e1", 0, 1200, -600, 1200, 11_000]]);
  });

  it("ignores non-walkable destinations and stale sequence numbers", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    expect(room.handle("a", ["move", 1, 1100, 0])).toEqual([]); // inside the hole
    expect(room.handle("a", ["move", 5, 100, 0])).toHaveLength(1);
    expect(room.handle("a", ["move", 5, 200, 0])).toEqual([]);
    expect(room.handle("a", ["move", 4, 200, 0])).toEqual([]);
  });

  it("clips a walk through an obstacle to stop in front of it", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    const [m] = msgs(room.handle("a", ["move", 1, 2000, 0]));
    expect(m?.[0]).toBe("moved");
    const tx = m?.[4] as number;
    expect(tx).toBeLessThan(1000);
    expect(tx).toBeGreaterThan(980);
    expect(mesh.contains([tx, 0])).toBe(true);
  });

  it("clamps very long walks to the maximum leg length (no teleports)", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    const [m] = msgs(room.handle("a", ["move", 1, -15000, 0]));
    expect(m).toEqual(["moved", "e1", 0, 0, -MAX_MOVE_DISTANCE, 0, 10_000]);
  });

  it("a move to the current position stops the Friend mid-walk", () => {
    const { room, clock } = makeRoom();
    room.join("a", profile());
    room.handle("a", ["move", 1, -6000, 0]);
    clock.advance(500);
    room.handle("a", ["move", 2, -600, 0]);
    clock.advance(10_000);
    expect(room.snapshot()[0]).toMatchObject({ x: -600, z: 0 });
  });
});

describe("Room events", () => {
  it("relays emote, say and venue to everyone; pong goes to the sender with the server clock", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    expect(msgs(room.handle("a", ["emote", 3]))).toEqual([["emote", "e1", 3]]);
    expect(msgs(room.handle("a", ["say", 7]))).toEqual([["say", "e1", 7]]);
    expect(msgs(room.handle("a", ["venue", "pixel-life"]))).toEqual([["venue", "e1", "pixel-life"]]);
    expect(room.handle("a", ["venue", "pixel-life"])).toEqual([]); // unchanged
    expect(room.snapshot()[0]?.venue).toBe("pixel-life");
    expect(room.handle("a", ["ping", 5])).toEqual([{ kind: "send", conn: "a", msg: ["pong", 10_000] }]);
  });

  it("drops venue ids outside the allow-list without punishing", () => {
    const { room } = makeRoom({ isVenue: (v) => v === "pixel-life" });
    room.join("a", profile());
    expect(room.handle("a", ["venue", "casino"])).toEqual([]);
  });

  it("updates scars once per token and relays the new hash", () => {
    const { room } = makeRoom();
    room.join("a", profile("9"));
    expect(msgs(room.updateToken("9", { scarsHash: "h1", goldHeld: 2 }))).toEqual([["scars", "9", "h1"]]);
    expect(room.updateToken("9", { scarsHash: "h1" })).toEqual([]);
    expect(room.snapshot()[0]).toMatchObject({ scarsHash: "h1", goldHeld: 2 });
  });
});

describe("Room rate limits", () => {
  it("drops over-rate messages and kicks with 4008 on the third violation", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    room.join("b", profile("2"));
    expect(room.handle("a", ["emote", 0])).toHaveLength(1);
    expect(room.handle("a", ["emote", 0])).toEqual([]); // violation 1
    expect(room.handle("a", ["emote", 0])).toEqual([]); // violation 2
    const out = room.handle("a", ["emote", 0]); // violation 3
    expect(out).toEqual([
      { kind: "send", conn: "a", msg: ["kick", WS_CLOSE.rateLimited] },
      { kind: "broadcast", except: null, msg: ["leave", "e1"] },
      { kind: "close", conn: "a", code: WS_CLOSE.rateLimited, reason: "emote rate exceeded" },
    ]);
    expect(room.has("a")).toBe(false);
    expect(room.size).toBe(1);
  });

  it("accepts a sustained 8 moves/s forever", () => {
    const { room, clock } = makeRoom();
    room.join("a", profile());
    for (let i = 1; i <= 400; i++) {
      clock.advance(125);
      expect(room.handle("a", ["move", i, (i % 20) * 50, 0])).toHaveLength(1);
    }
  });

  it("forgives old violations so rare bursts never add up to a kick", () => {
    const { room, clock } = makeRoom();
    room.join("a", profile());
    for (let i = 0; i < 10; i++) {
      room.handle("a", ["say", 1]);
      room.handle("a", ["say", 1]); // one violation per round
      clock.advance(31_000);
    }
    expect(room.has("a")).toBe(true);
  });

  it("counts malformed frames as violations and kicks with 4000", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    expect(room.receive("a", "not json")).toEqual([]);
    expect(room.receive("a", '["move",1,99999,0]')).toEqual([]);
    const out = room.receive("a", '["teleport"]');
    expect(out.at(-1)).toMatchObject({ kind: "close", code: WS_CLOSE.badMessage });
  });

  it("parses valid frames", () => {
    const { room } = makeRoom();
    room.join("a", profile());
    expect(msgs(room.receive("a", '["emote",2]'))).toEqual([["emote", "e1", 2]]);
  });
});
