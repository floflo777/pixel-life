import { mulberry32, type ServerMsg } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock.js";
import { rect } from "../geometry.js";
import { HUB_WALK_SPEED } from "../motion.js";
import { Navmesh } from "../navmesh.js";
import { type Outbound, Room } from "../room.js";
import { profile } from "../test-util.js";
import { INTERPOLATION_DELAY_MS, PresenceBuffer } from "./interpolation.js";

const FRAME_MS = 1000 / 60;
const mesh = new Navmesh({
  room: "plaza",
  version: 1,
  areas: [rect(-5000, -5000, 5000, 5000)],
  holes: [],
  spawns: [[0, 0]],
  doors: [],
  landmarks: [],
});

/**
 * Drives a real Room with a joystick-style client (a new heading every 125 ms, frequent stops) and records every
 * server message with its send time, so the client side can be replayed under any latency profile.
 */
function recordWalk(seconds: number, seed: number): { log: { t: number; msg: ServerMsg }[]; id: string } {
  const clock = new ManualClock(0);
  let n = 0;
  const room = new Room({
    slug: "plaza",
    shard: 0,
    walkable: mesh,
    clock,
    spawns: [[0, 0]],
    nextEntityId: () => `e${++n}`,
  });
  const log: { t: number; msg: ServerMsg }[] = [];
  const keep = (out: Outbound[] | undefined) => {
    for (const o of out ?? []) if (o.kind !== "close") log.push({ t: clock.now(), msg: o.msg });
  };
  keep(room.join("a", profile())?.out);
  const rnd = mulberry32(seed);
  let seq = 0;
  let x = 0;
  let z = 0;
  for (let t = 125; t <= seconds * 1000; t += 125) {
    clock.set(t);
    const r = rnd() % 10;
    if (r < 2) {
      keep(room.handle("a", ["move", ++seq, Math.round(x), Math.round(z)])); // stop where we think we are
    } else {
      x = Math.max(-4000, Math.min(4000, x + ((rnd() % 600) - 300)));
      z = Math.max(-4000, Math.min(4000, z + ((rnd() % 600) - 300)));
      keep(room.handle("a", ["move", ++seq, Math.round(x), Math.round(z)]));
    }
  }
  return { log, id: "e1" };
}

/** Replays `log` into a buffer with per-message latency (TCP keeps order) and samples at 60 fps. */
function render(log: { t: number; msg: ServerMsg }[], latency: (i: number) => number, id: string) {
  const buf = new PresenceBuffer();
  const reference = new PresenceBuffer();
  for (const m of log) reference.apply(m.msg);
  let lastDelivery = 0;
  const arrivals = log.map((m, i) => (lastDelivery = Math.max(lastDelivery, m.t + latency(i))));
  const end = (log.at(-1)?.t ?? 0) + 1000;
  let next = 0;
  const frames: { x: number; z: number; ref: { x: number; z: number } }[] = [];
  for (let now = arrivals[0] ?? 0; now < end; now += FRAME_MS) {
    while (next < log.length && (arrivals[next] as number) <= now) buf.apply((log[next++] as { msg: ServerMsg }).msg);
    const t = now - INTERPOLATION_DELAY_MS;
    const s = buf.sample(id, t);
    const r = reference.sample(id, t);
    if (s && r) frames.push({ x: s.x, z: s.z, ref: { x: r.x, z: r.z } });
  }
  return frames;
}

function maxStep(frames: { x: number; z: number }[]): number {
  let m = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as { x: number; z: number };
    const b = frames[i] as { x: number; z: number };
    m = Math.max(m, Math.hypot(b.x - a.x, b.z - a.z));
  }
  return m;
}

describe("PresenceBuffer interpolation", () => {
  const { log, id } = recordWalk(20, 7);
  const perFrame = (HUB_WALK_SPEED * FRAME_MS) / 1000; // 20 cm at 60 fps

  it("reproduces the exact server path when latency stays under the buffer delay", () => {
    const rnd = mulberry32(1);
    const frames = render(log, () => 20 + (rnd() % 90), id);
    expect(frames.length).toBeGreaterThan(1000);
    for (const f of frames) {
      expect(Math.abs(f.x - f.ref.x)).toBeLessThan(0.5);
      expect(Math.abs(f.z - f.ref.z)).toBeLessThan(0.5);
    }
    // Never faster than walking speed (plus rounding of `from` to whole cm).
    expect(maxStep(frames)).toBeLessThanOrEqual(perFrame + 1);
  });

  it("never teleports under latency spikes beyond the buffer: late walks are blended in", () => {
    const rnd = mulberry32(2);
    // 10 % of messages arrive 150-400 ms late (Wi-Fi hiccup); the rest are normal.
    const frames = render(log, () => (rnd() % 10 === 0 ? 150 + (rnd() % 250) : 30 + (rnd() % 60)), id);
    const step = maxStep(frames);
    // The scenario really does deliver walks late (the drawn path diverges by metres at times)…
    expect(Math.max(...frames.map((f) => Math.hypot(f.x - f.ref.x, f.z - f.ref.z)))).toBeGreaterThan(100);
    // A naive snap would jump up to 2 × speed × lateness (≈ 7 m); the blend keeps every frame within a few steps.
    expect(step).toBeLessThan(perFrame * 4);
    // And it converges back onto the server path once the spike is over.
    const last = frames.at(-1) as (typeof frames)[number];
    expect(Math.hypot(last.x - last.ref.x, last.z - last.ref.z)).toBeLessThan(1);
  });

  it("tracks roster, joins, leaves, venue and scars", () => {
    const buf = new PresenceBuffer();
    const e = {
      id: "e1",
      kind: "guest",
      tokenId: "7",
      loaned: true,
      x: 10,
      z: 20,
      venue: null,
      scarsHash: "a",
      goldHeld: 0,
    } as const;
    buf.apply(["welcome", "e1", [e], 0]);
    expect(buf.you).toBe("e1");
    expect(buf.sample("e1", 5)).toMatchObject({ x: 10, z: 20, moving: false });
    buf.apply(["join", { ...e, id: "e2", tokenId: "8" }]);
    buf.apply(["venue", "e2", "pixel-life"]);
    buf.apply(["scars", "8", "b"]);
    expect(buf.entity("e2")).toMatchObject({ venue: "pixel-life", scarsHash: "b" });
    buf.apply(["moved", "e1", 10, 20, 1210, 20, 100]);
    expect(buf.sample("e1", 600)).toMatchObject({ x: 610, z: 20, moving: true, heading: [1, 0] });
    expect(buf.sample("e1", 5000)).toMatchObject({ x: 1210, moving: false });
    buf.apply(["leave", "e2"]);
    expect(buf.ids()).toEqual(["e1"]);
  });
});
