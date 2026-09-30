import { type ClientMsg, encodeMsg, mulberry32, ROOM_HARD_CAP, ROOMS, type RoomSlug } from "@pl/shared";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock.js";
import type { Vec2 } from "./geometry.js";
import { Hub, type HubSession } from "./hub.js";
import { Navmesh } from "./navmesh.js";
import { HUB_NAVMESHES } from "./rooms.js";
import { profile } from "./test-util.js";
import { MemorySocket, MemoryTransport } from "./transport.js";

/**
 * Load simulation: 5 shards (one per room) × 60 clients (the hard cap) for 30 s of virtual time with realistic,
 * honest message rates. Measures the wall-clock processing time of every inbound frame (decode, validate, rate
 * limit, navmesh, encode, fan-out into the transport) and checks fan-out counts exactly.
 */
const SECONDS = 30;
const STEP_MS = 5;

interface Sim {
  readonly slug: RoomSlug;
  readonly session: HubSession;
  readonly socket: MemorySocket;
  readonly mesh: Navmesh;
  seq: number;
  nextMove: number;
  joystickUntil: number;
  nextEmote: number;
  nextSay: number;
  nextPing: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

describe("load: 60 clients × 5 shards", () => {
  it("keeps p95 processing latency low and fans out exactly once per member", () => {
    const clock = new ManualClock(1_000_000);
    const transport = new MemoryTransport({ record: false });
    const hub = new Hub({ transport, clock });
    const rnd = mulberry32(0x5eed);
    const r01 = () => rnd() / 2 ** 32;

    const sims: Sim[] = [];
    for (const slug of ROOMS) {
      const mesh = new Navmesh(HUB_NAVMESHES[slug]);
      for (let i = 0; i < ROOM_HARD_CAP; i++) {
        const socket = new MemorySocket();
        const res = hub.join(socket, {
          identityKey: `guest:${slug}:${i}`,
          owner: null,
          room: slug,
          shard: 0,
          profile: profile(String(10_000 + sims.length), "guest"),
        });
        if (!res.ok) throw new Error(`join refused: ${res.reason}`);
        const t = clock.now();
        sims.push({
          slug,
          session: res.session,
          socket,
          mesh,
          seq: 0,
          nextMove: t + r01() * 2000,
          joystickUntil: 0,
          nextEmote: t + 2000 + r01() * 20_000,
          nextSay: t + 2000 + r01() * 30_000,
          nextPing: t + r01() * 5000,
        });
      }
    }
    expect(hub.roomCount).toBe(5);
    for (const slug of ROOMS) expect(hub.directory.count(`room:${slug}:0`)).toBe(ROOM_HARD_CAP);

    const joinFrames = transport.sent;
    const latencies: number[] = [];
    const broadcastsPerRoom = new Map<RoomSlug, number>(ROOMS.map((r) => [r, 0]));
    const pingsPerRoom = new Map<RoomSlug, number>(ROOMS.map((r) => [r, 0]));
    let unicast = 0;
    let moves = 0;

    const randomWalkable = (mesh: Navmesh): Vec2 => {
      for (;;) {
        const p: Vec2 = [Math.round((r01() - 0.5) * 6000), Math.round((r01() - 0.5) * 6000)];
        if (mesh.contains(p)) return p;
      }
    };
    const send = (s: Sim, msg: ClientMsg) => {
      const frame = encodeMsg(msg);
      const t0 = performance.now();
      s.session.receive(frame);
      latencies.push(performance.now() - t0);
      if (msg[0] === "ping") {
        unicast++;
        pingsPerRoom.set(s.slug, (pingsPerRoom.get(s.slug) ?? 0) + 1);
      } else broadcastsPerRoom.set(s.slug, (broadcastsPerRoom.get(s.slug) ?? 0) + 1);
    };

    const end = clock.now() + SECONDS * 1000;
    while (clock.now() < end) {
      clock.advance(STEP_MS);
      const now = clock.now();
      for (const s of sims) {
        if (now >= s.nextMove) {
          // ~15 % of decisions start a 1-3 s joystick drag at the 8/s cap; otherwise a click every 1-4 s.
          if (now >= s.joystickUntil && r01() < 0.15) s.joystickUntil = now + 1000 + r01() * 2000;
          const [x, z] = randomWalkable(s.mesh);
          send(s, ["move", ++s.seq, x, z]);
          moves++;
          s.nextMove = now < s.joystickUntil ? now + 125 : now + 1000 + r01() * 3000;
        }
        if (now >= s.nextEmote) {
          send(s, ["emote", Math.floor(r01() * 8)]);
          s.nextEmote = now + 5000 + r01() * 20_000;
        }
        if (now >= s.nextSay) {
          send(s, ["say", Math.floor(r01() * 16)]);
          s.nextSay = now + 8000 + r01() * 30_000;
        }
        if (now >= s.nextPing) {
          send(s, ["ping", now]);
          s.nextPing = now + 5000;
        }
      }
    }

    // Honest clients are never kicked, and every accepted event reached all 60 members of its shard exactly once.
    expect(transport.closes).toBe(0);
    for (const slug of ROOMS) {
      const members = sims.filter((s) => s.slug === slug);
      const received = members.reduce((sum, s) => sum + s.socket.received, 0);
      // Joining: member i got its welcome plus one `join` for each of the members after it.
      const joinFrames = members.reduce((sum, _s, i) => sum + 1 + (ROOM_HARD_CAP - 1 - i), 0);
      const bc = broadcastsPerRoom.get(slug) ?? 0;
      expect(bc).toBeGreaterThan(0);
      expect(received - joinFrames).toBe(bc * ROOM_HARD_CAP + (pingsPerRoom.get(slug) ?? 0));
    }
    const totalBroadcasts = [...broadcastsPerRoom.values()].reduce((a, b) => a + b, 0);
    expect(transport.sent - joinFrames).toBe(totalBroadcasts * ROOM_HARD_CAP + unicast);

    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);
    const p99 = percentile(latencies, 0.99);
    const inRate = latencies.length / SECONDS;
    const outRate = (transport.sent - joinFrames) / SECONDS;
    console.info(
      `[load] ${latencies.length} frames in (${inRate.toFixed(0)}/s, ${(moves / SECONDS).toFixed(0)} moves/s), ` +
        `${outRate.toFixed(0)} frames/s out; p50 ${(p50 * 1000).toFixed(1)} µs, p95 ${(p95 * 1000).toFixed(1)} µs, ` +
        `p99 ${(p99 * 1000).toFixed(1)} µs, max ${((latencies.at(-1) ?? 0) * 1000).toFixed(0)} µs`,
    );
    // Budget: one event must cost far less than the 125 ms joystick period even on a slow CI box.
    expect(p95).toBeLessThan(1);
    // All inbound work for 300 players must fit in a small fraction of one core.
    const busy = latencies.reduce((a, b) => a + b, 0);
    expect(busy / (SECONDS * 1000)).toBeLessThan(0.25);
  });

  it("worst case: a full shard all dragging joysticks at 8 moves/s", () => {
    const clock = new ManualClock();
    const transport = new MemoryTransport({ record: false });
    const hub = new Hub({ transport, clock });
    const sessions: HubSession[] = [];
    for (let i = 0; i < ROOM_HARD_CAP; i++) {
      const res = hub.join(new MemorySocket(), {
        identityKey: `g${i}`,
        owner: null,
        room: "plaza",
        shard: 0,
        profile: profile(String(i + 1)),
      });
      if (!res.ok) throw new Error(res.reason);
      sessions.push(res.session);
    }
    const base = transport.sent;
    const latencies: number[] = [];
    const seconds = 10;
    for (let tick = 1; tick <= seconds * 8; tick++) {
      clock.advance(125);
      sessions.forEach((s, i) => {
        // A 17 u ring clear of the fountain, the Daily Stone and the notice board.
        const angle = (tick + i) * 0.3;
        const frame = encodeMsg(["move", tick, Math.round(1700 * Math.cos(angle)), Math.round(1700 * Math.sin(angle))]);
        const t0 = performance.now();
        s.receive(frame);
        latencies.push(performance.now() - t0);
      });
    }
    // Every move is accepted and reaches all 60 members: 60 × 8 × 60 = 28 800 frames/s from one shard.
    expect(transport.closes).toBe(0);
    expect(transport.sent - base).toBe(seconds * 8 * ROOM_HARD_CAP * ROOM_HARD_CAP);
    latencies.sort((a, b) => a - b);
    const p95 = percentile(latencies, 0.95);
    console.info(`[load:worst] ${latencies.length} moves, p95 ${(p95 * 1000).toFixed(1)} µs`);
    expect(p95).toBeLessThan(1);
  });

  it("a flooding client is cut off after 3 violations while its neighbours keep full service", () => {
    const clock = new ManualClock();
    const transport = new MemoryTransport({ record: false });
    const hub = new Hub({ transport, clock });
    const sockets: MemorySocket[] = [];
    const sessions: HubSession[] = [];
    for (let i = 0; i < ROOM_HARD_CAP; i++) {
      const socket = new MemorySocket();
      const res = hub.join(socket, {
        identityKey: `g${i}`,
        owner: null,
        room: "plaza",
        shard: 0,
        profile: profile(String(i + 1)),
      });
      if (!res.ok) throw new Error(res.reason);
      sockets.push(socket);
      sessions.push(res.session);
    }
    const flooder = sessions[0] as HubSession;
    for (let i = 1; i <= 100; i++) flooder.receive(encodeMsg(["move", i, 100, 100]));
    // 16 burst accepted, then 3 violations → kicked; nothing after that is processed.
    expect(sockets[0]?.closed?.code).toBe(4008);
    const neighbour = sockets[1] as MemorySocket;
    const before = neighbour.received;
    (sessions[1] as HubSession).receive(encodeMsg(["emote", 0]));
    expect(neighbour.received).toBe(before + 1);
    expect(hub.populations().plaza).toBe(ROOM_HARD_CAP - 1);
  });
});
