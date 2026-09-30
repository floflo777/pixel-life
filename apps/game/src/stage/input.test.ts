import { describe, expect, it } from "vitest";
import { GestureTracker, KeyAxes, isGameKey, keyAction, toPoint } from "./input";

function tracker(): GestureTracker {
  const g = new GestureTracker();
  g.resize(400, 200);
  return g;
}

describe("toPoint", () => {
  it("maps CSS px to NDC with y up", () => {
    expect(toPoint(0, 0, 400, 200)).toEqual({ x: 0, y: 0, ndcX: -1, ndcY: 1 });
    expect(toPoint(200, 100, 400, 200)).toMatchObject({ ndcX: 0, ndcY: 0 });
    expect(toPoint(400, 200, 400, 200)).toMatchObject({ ndcX: 1, ndcY: -1 });
  });
  it("survives a zero-size canvas", () => {
    expect(Number.isFinite(toPoint(5, 5, 0, 0).ndcX)).toBe(true);
  });
});

describe("GestureTracker", () => {
  it("emits a tap for a short still press", () => {
    const g = tracker();
    g.down(1, 100, 50, 0, "mouse");
    g.move(1, 102, 51, 40);
    expect(g.up(1, 102, 51, 120)).toEqual([{ type: "tap", at: toPoint(100, 50, 400, 200), kind: "mouse" }]);
  });

  it("drops a long still press (not a tap, not a drag)", () => {
    const g = tracker();
    g.down(1, 100, 50, 0, "mouse");
    expect(g.up(1, 100, 50, 900)).toEqual([]);
  });

  it("gives touch a larger slop than mouse", () => {
    const g = tracker();
    g.down(1, 100, 50, 0, "touch");
    expect(g.move(1, 110, 50, 30)).toEqual([]);
    expect(g.up(1, 110, 50, 60)[0]?.type).toBe("tap");
    const m = tracker();
    m.down(1, 100, 50, 0, "mouse");
    expect(m.move(1, 110, 50, 30).map((e) => e.type)).toEqual(["dragstart", "drag"]);
  });

  it("reports drag vectors and a release velocity for flings", () => {
    const g = tracker();
    g.down(7, 200, 100, 0, "touch");
    const ev = g.move(7, 150, 100, 100);
    expect(ev.map((e) => e.type)).toEqual(["dragstart", "drag"]);
    const drag = ev[1];
    expect(drag?.type === "drag" && drag.vector).toEqual({ x: -50, y: 0 });
    g.move(7, 120, 100, 180);
    const end = g.up(7, 100, 100, 200);
    expect(end).toHaveLength(1);
    const e = end[0];
    if (e?.type !== "dragend") throw new Error("expected dragend");
    expect(e.vector).toEqual({ x: -100, y: 0 });
    expect(e.durationMs).toBe(200);
    // Only samples in the last 80 ms count: (100 − 120) px over 20 ms... plus the 180 ms sample.
    expect(e.velocity.x).toBeLessThan(0);
    expect(e.velocity.y).toBe(0);
  });

  it("turns a fast flick with no intermediate moves into dragstart + dragend", () => {
    const g = tracker();
    g.down(1, 10, 10, 0, "mouse");
    expect(g.up(1, 90, 10, 50).map((e) => e.type)).toEqual(["dragstart", "dragend"]);
  });

  it("ignores moves from other pointers", () => {
    const g = tracker();
    g.down(1, 10, 10, 0, "touch");
    expect(g.move(2, 300, 10, 10)).toEqual([]);
  });

  it("cancels a drag when a second finger lands (pinch is never a fling)", () => {
    const g = tracker();
    g.down(1, 10, 10, 0, "touch");
    g.move(1, 60, 10, 30);
    expect(g.down(2, 200, 10, 40, "touch")).toEqual([{ type: "cancel" }]);
    expect(g.up(1, 80, 10, 50)).toEqual([]);
    // While the second finger is still down no new gesture starts.
    expect(g.down(3, 5, 5, 60, "touch")).toEqual([]);
    g.up(2, 200, 10, 70);
    g.up(3, 5, 5, 80);
    g.down(4, 5, 5, 100, "touch");
    expect(g.up(4, 5, 5, 150)[0]?.type).toBe("tap");
  });

  it("cancels on pointercancel / blur", () => {
    const g = tracker();
    g.down(1, 10, 10, 0, "mouse");
    g.move(1, 60, 10, 30);
    expect(g.cancel()).toEqual([{ type: "cancel" }]);
    expect(g.pressed).toBe(false);
    expect(g.up(1, 60, 10, 50)).toEqual([]);
  });
});

describe("KeyAxes", () => {
  it("normalises diagonals and cancels opposites", () => {
    const k = new KeyAxes();
    k.set("KeyD", true);
    expect(k.axis()).toEqual({ x: 1, y: 0 });
    k.set("KeyW", true);
    const a = k.axis();
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1, 9);
    expect(a.x).toBeGreaterThan(0);
    expect(a.y).toBeLessThan(0);
    k.set("KeyA", true);
    expect(k.axis()).toEqual({ x: 0, y: -1 });
  });

  it("does not double-count WASD and arrows for the same direction", () => {
    const k = new KeyAxes();
    k.set("KeyD", true);
    k.set("ArrowRight", true);
    expect(k.axis()).toEqual({ x: 1, y: 0 });
  });

  it("drops auto-repeat and clears on blur", () => {
    const k = new KeyAxes();
    expect(k.set("KeyS", true)).toBe(true);
    expect(k.set("KeyS", true)).toBe(false);
    expect(k.clear()).toEqual(["KeyS"]);
    expect(k.axis()).toEqual({ x: 0, y: 0 });
  });
});

describe("key mapping", () => {
  it("maps confirm/cancel/emote and recognises game keys", () => {
    expect(keyAction("Space")).toBe("confirm");
    expect(keyAction("Enter")).toBe("confirm");
    expect(keyAction("Escape")).toBe("cancel");
    expect(keyAction("KeyE")).toBe("emote");
    expect(keyAction("KeyQ")).toBeNull();
    expect(isGameKey("ArrowUp")).toBe(true);
    expect(isGameKey("Tab")).toBe(false);
  });
});
