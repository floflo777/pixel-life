import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { EMOTES, QUICK_CHAT_PHRASES } from "@pl/shared";
import { HUB_NAVMESHES, Navmesh, type Vec2 } from "@pl/realtime";
import { BubbleBoard } from "./bubbles";
import { deadZoneFor, followGoal, FOLLOW } from "./camera";
import { facingFromHeading, plateYaw, toWire, toWorld, WORLD_PER_WIRE } from "./coords";
import { DoorTracker } from "./doors";
import { emoteDurationMs, emoteFrame } from "./emotes";
import { classifyTap, screenToGround, stickAxis, type FriendHitBox } from "./intents";
import { NEAR_HYSTERESIS, selectNear, selectTags } from "./lod";
import { emoteId, emoteName, phraseText, QUICK_CHAT_TEXT } from "./phrases";
import { dailyCountdown, haloTint, shortDuration, statusLine, venueName } from "./status";
import { LocalWalker, STEER_RESEND_MS } from "./walker";

const plaza = new Navmesh(HUB_NAVMESHES.plaza);

describe("coords", () => {
  it("maps the 40 u plaza to 16 world units and back", () => {
    expect(toWorld(2000, 0).x).toBeCloseTo(8);
    expect(toWire(8, -4)).toEqual([2000, -1000]);
    expect(WORLD_PER_WIRE * 1200).toBeCloseTo(4.8);
  });
  it("picks sprite facings from headings (toward camera = down)", () => {
    expect(facingFromHeading(0, 1)).toBe("down");
    expect(facingFromHeading(0, -1)).toBe("up");
    expect(facingFromHeading(1, 0.5)).toBe("right");
    expect(facingFromHeading(-1, -1)).toBe("left");
    expect(facingFromHeading(0, 0, "up")).toBe("up");
  });
  it("clamps plate yaw to ±20° of the camera yaw", () => {
    expect(plateYaw(0, 0, 0, 10, 0)).toBeCloseTo(0);
    expect(plateYaw(-50, 0, 0, 1, 0)).toBeCloseTo((20 * Math.PI) / 180);
    expect(plateYaw(50, 0, 0, 1, 0)).toBeCloseTo((-20 * Math.PI) / 180);
  });
});

describe("phrases", () => {
  it("has one text per protocol phrase id and rejects unknown ids", () => {
    expect(QUICK_CHAT_TEXT).toHaveLength(QUICK_CHAT_PHRASES);
    expect(phraseText(0)).toBe("hi!");
    expect(phraseText(QUICK_CHAT_PHRASES)).toBeNull();
    expect(phraseText(-1)).toBeNull();
  });
  it("round-trips emote ids", () => {
    for (const e of EMOTES) expect(emoteName(emoteId(e))).toBe(e);
    expect(emoteName(99)).toBeNull();
  });
});

describe("BubbleBoard", () => {
  it("shows one bubble at a time and plays queued ones in order", () => {
    const b = new BubbleBoard({ emoteMs: 100, sayMs: 300, maxQueue: 2 });
    b.push("a", "emote", "♥", 0);
    b.push("a", "say", "gg", 10);
    expect(b.current("a", 50)?.text).toBe("♥");
    expect(b.current("a", 100)?.text).toBe("gg");
    expect(b.current("a", 399)?.text).toBe("gg");
    expect(b.current("a", 400)).toBeNull();
  });
  it("drops the oldest pending bubble beyond the queue size", () => {
    const b = new BubbleBoard({ emoteMs: 100, sayMs: 100, maxQueue: 1 });
    b.push("a", "emote", "1", 0);
    b.push("a", "emote", "2", 1);
    b.push("a", "emote", "3", 2);
    expect(b.current("a", 5)?.text).toBe("1");
    expect(b.current("a", 100)?.text).toBe("3");
  });
  it("mutes a Friend (block) and clears what it shows", () => {
    const b = new BubbleBoard();
    b.push("a", "say", "hi", 0);
    b.setMuted("a", true);
    expect(b.current("a", 1)).toBeNull();
    expect(b.push("a", "say", "hi", 2)).toBe(false);
    b.setMuted("a", false);
    expect(b.push("a", "say", "hi", 3)).toBe(true);
    expect(b.visible(4).size).toBe(1);
  });
});

describe("LOD", () => {
  const ring = Array.from({ length: 60 }, (_, i) => ({ key: `e${i}`, x: i * 0.5, z: 0 }));
  it("keeps the nearest within budget plus pinned keys", () => {
    const near = selectNear(ring, { x: 0, z: 0 }, 10, new Set(), new Set(["e59"]));
    expect(near.size).toBe(10);
    expect(near.has("e59")).toBe(true);
    expect(near.has("e0")).toBe(true);
    expect(near.has("e20")).toBe(false);
  });
  it("applies hysteresis so a Friend at the boundary does not flicker", () => {
    const c = [
      { key: "a", x: 5, z: 0 },
      { key: "b", x: 5 - NEAR_HYSTERESIS / 2, z: 0 },
    ];
    expect([...selectNear(c, { x: 0, z: 0 }, 1, new Set(["a"]))]).toEqual(["a"]);
    expect([...selectNear(c, { x: 0, z: 0 }, 1, new Set())]).toEqual(["b"]);
  });
  it("never exceeds the budget (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.float({ min: -20, max: 20, noNaN: true }), fc.float({ min: -20, max: 20, noNaN: true })), {
          maxLength: 70,
        }),
        fc.integer({ min: 0, max: 30 }),
        (pts, max) => {
          const c = pts.map(([x, z], i) => ({ key: String(i), x, z }));
          expect(selectNear(c, { x: 0, z: 0 }, max).size).toBe(Math.min(max, c.length));
        },
      ),
    );
  });
  it("tags: full near, id further, nothing beyond, at most 12, pinned always full", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, distance: i }));
    const t = selectTags([...items, { key: "you", distance: 0, pinned: true }]);
    expect(t.get("you")).toBe("full");
    expect(t.size).toBe(12);
    expect(t.get("k3")).toBe("full");
    expect(t.get("k9")).toBe("id");
    const far = selectTags([{ key: "x", distance: 17 }]);
    expect(far.size).toBe(0);
  });
});

describe("intents", () => {
  const box = (key: string, depth: number, scarred = false, isYou = false): FriendHitBox => ({
    key,
    tokenId: key,
    left: 100,
    right: 200,
    top: 100,
    bottom: 300,
    depth,
    scarred,
    isYou,
  });
  it("picks the front-most Friend: scarred → mend, else inspect, you → self", () => {
    expect(classifyTap(150, 200, [box("a", 10, true), box("b", 5)], [])).toEqual({
      type: "inspect",
      tokenId: "b",
      key: "b",
    });
    expect(classifyTap(150, 200, [box("a", 3, true), box("b", 5)], [])).toEqual({
      type: "mend",
      tokenId: "a",
      key: "a",
    });
    expect(classifyTap(150, 200, [box("me", 1, true, true)], [])).toEqual({ type: "self" });
  });
  it("falls back to doors, then ground", () => {
    expect(classifyTap(500, 500, [box("a", 1)], [{ id: "d", x: 510, y: 505, radius: 30 }])).toEqual({
      type: "door",
      id: "d",
    });
    expect(classifyTap(500, 500, [], [])).toEqual({ type: "ground" });
  });
  it("turns drags into a stick with a dead zone", () => {
    expect(stickAxis(5, 5)).toBeNull();
    const s = stickAxis(200, 0);
    expect(s?.x).toBeCloseTo(1);
    const m = stickAxis(0, 30);
    expect(m && m.y > 0.3 && m.y < 1).toBe(true);
  });
  it("rotates screen axes onto the ground by the camera yaw", () => {
    const [x, z] = screenToGround(1, 0, 0);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(0);
    const [x2, z2] = screenToGround(0, 1, Math.PI / 2);
    expect(x2).toBeCloseTo(1);
    expect(z2).toBeCloseTo(0);
  });
});

describe("camera follow", () => {
  const bounds = { minX: -5, maxX: 5, minZ: -6, maxZ: 6 };
  it("looks ahead of you, leads the walk, and clamps to the room", () => {
    const g = followGoal(0, 3, null, bounds);
    expect(g.z).toBeCloseTo(3 - FOLLOW.ahead);
    const led = followGoal(0, 3, { x: 1, z: 0 }, bounds);
    expect(led.x).toBeCloseTo(FOLLOW.lead);
    expect(followGoal(40, -40, null, bounds)).toMatchObject({ x: 5, z: -6 });
  });
  it("uses a quarter-screen dead zone, none under reduced motion", () => {
    expect(deadZoneFor(20, false)).toBeCloseTo(2.5);
    expect(deadZoneFor(20, true)).toBe(0);
  });
});

describe("DoorTracker", () => {
  const zone = {
    id: "d",
    kind: "room" as const,
    target: "x",
    area: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as Vec2[],
  };
  it("is disarmed on arrival and fires once per entry", () => {
    const t = new DoorTracker([zone]);
    expect(t.update([5, 5])).toBeNull(); // spawned inside: no bounce
    expect(t.update([50, 50])).toBeNull();
    expect(t.update([5, 5])?.id).toBe("d");
    expect(t.update([6, 6])).toBeNull();
    t.update([50, 50]);
    expect(t.update([5, 5])?.id).toBe("d");
  });
});

describe("emotes", () => {
  it("steps at 12 fps and ends", () => {
    for (const e of EMOTES) {
      const d = emoteDurationMs(e);
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(834);
      expect(emoteFrame(e, d + 1)).toBeNull();
    }
    expect(emoteFrame("hop", 40)).toEqual(emoteFrame("hop", 80)); // same 83 ms step
    expect(emoteFrame("hop", 250)?.dy).toBeGreaterThan(0);
  });
  it("drops body motion under reduced motion", () => {
    expect(emoteFrame("spin", 300, true)?.roll).toBe(0);
    expect(emoteFrame("hop", 250, true)?.dy).toBe(0);
  });
  it("marks exactly one stomp impact frame", () => {
    const hits = Array.from({ length: 8 }, (_, i) => emoteFrame("stomp", (i * 1000) / 12 + 1)?.impact).filter(Boolean);
    expect(hits).toHaveLength(1);
  });
});

describe("status", () => {
  it("tints halos by streak tier", () => {
    expect([0, 3, 7, 14, 30].map(haloTint)).toEqual(["halo", "sun", "coral", "lilac", "goldWhite"]);
  });
  it("writes short status lines, most important first", () => {
    const base = {
      isYou: false,
      resting: false,
      loaned: false,
      tokenId: "1",
      venue: null,
      lostPx: 0,
      healsInMs: null,
      gold: 0,
      mendedByYou: false,
    };
    expect(statusLine(base)).toBe("");
    expect(statusLine({ ...base, venue: "pixel-life" })).toBe("→ loose pixels");
    expect(statusLine({ ...base, lostPx: 3, healsInMs: 3 * 3600_000 })).toBe("heals 3h");
    expect(statusLine({ ...base, gold: 5 })).toBe("gold ×5");
    expect(statusLine({ ...base, mendedByYou: true, lostPx: 2, resting: true })).toBe("mended by you · resting");
    expect(statusLine({ ...base, loaned: true })).toBe("on loan");
  });
  it("formats durations, venue names and the Daily countdown", () => {
    expect(shortDuration(90_000)).toBe("2m");
    expect(shortDuration(72 * 3600_000)).toBe("3d");
    expect(venueName("stack-four")).toBe("stack four");
    expect(dailyCountdown(Date.UTC(2026, 8, 30, 23, 59, 30))).toBe("00:00:30");
  });
});

describe("LocalWalker", () => {
  it("plans around the fountain and sends one move per leg", () => {
    const w = new LocalWalker(plaza, [-1200, 0]);
    const path = w.walkTo([1200, 0]);
    expect(path && path.length).toBeGreaterThan(2);
    const first = w.update(0, 0);
    expect(first).toHaveLength(1);
    let sent = first.length;
    let t = 0;
    while (w.moving && t < 10_000) {
      t += 16;
      sent += w.update(16, t).length;
    }
    expect(w.position[0]).toBeCloseTo(1200, 0);
    expect(sent).toBe((path?.length ?? 0) - 1);
    // Every leg stays walkable (the server would clip otherwise).
    for (let i = 0; i + 1 < (path?.length ?? 0); i++)
      expect(plaza.segmentWalkable(path?.[i] as Vec2, path?.[i + 1] as Vec2)).toBe(true);
  });
  it("snaps taps off the mesh to the nearest walkable point", () => {
    const w = new LocalWalker(plaza, [0, 700]);
    expect(w.walkTo([0, 0])).not.toBeNull(); // inside the fountain hole
    expect(w.walkTo([9000, 9000])).not.toBeNull();
  });
  it("steers with a throttled look-ahead target and stops with a final move", () => {
    const w = new LocalWalker(plaza, [0, 700]);
    w.steer([1, 0]);
    const sends: number[] = [];
    for (let t = 0; t <= 1000; t += 16) if (w.update(16, t).length) sends.push(t);
    expect(sends.length).toBeGreaterThan(5);
    for (let i = 1; i < sends.length; i++)
      expect((sends[i] as number) - (sends[i - 1] as number)).toBeGreaterThanOrEqual(STEER_RESEND_MS);
    expect(w.position[0]).toBeGreaterThan(900);
    w.steer(null);
    const stop = w.update(16, 1100);
    expect(stop).toEqual([{ x: Math.round(w.position[0]), z: Math.round(w.position[1]) }]);
    expect(w.moving).toBe(false);
  });
  it("never steers off the navmesh", () => {
    const w = new LocalWalker(plaza, [0, 700]);
    w.steer([0, 1]);
    for (let t = 0; t < 20_000; t += 16) w.update(16, t);
    expect(plaza.contains(w.position)).toBe(true);
  });
});
