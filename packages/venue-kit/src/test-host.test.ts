import { EMPTY_MASK, fromIndices, frontMask, popcount, quote, type RunSummary } from "@pl/shared";
import { describe, expect, it } from "vitest";
import type { NativeVenue, VenueHost, VenueManifest } from "./contract.js";
import { createSignal, createTestVenueHost, type TestStage, TestHostError, testFriendView } from "./test-host.js";

const manifest: VenueManifest = {
  id: "demo",
  name: "Demo",
  version: "0.0.1",
  kind: "native",
  room: "plaza",
  requires: { ownedFriend: false },
  economy: { sinks: ["regrow"] },
  results: { affectsScars: true },
  thumbnail: "demo.png",
};

/** A tiny venue that counts frames while not paused and reports one result on exit. */
function demoVenue(): NativeVenue<TestStage> & { frames: () => number } {
  let frames = 0;
  return {
    manifest,
    frames: () => frames,
    async mount(host: VenueHost<TestStage>) {
      const off = host.stage.onFrame(() => {
        if (!host.paused.value) frames++;
      });
      host.audio.play("enter");
      return {
        pause() {},
        resize() {},
        async unmount() {
          off();
        },
      };
    },
  };
}

async function expectHostError(p: Promise<unknown>, code: TestHostError["code"]): Promise<void> {
  await expect(p).rejects.toMatchObject({ name: "TestHostError", code });
}

describe("createSignal", () => {
  it("notifies on change only, until unsubscribed", () => {
    const s = createSignal(1);
    const seen: number[] = [];
    const off = s.signal.subscribe((v) => seen.push(v));
    s.set(1);
    s.set(2);
    off();
    s.set(3);
    expect(seen).toEqual([2]);
    expect(s.signal.value).toBe(3);
  });
});

describe("createTestVenueHost", () => {
  it("drives the frame loop, pause, mute and cleanup", async () => {
    const h = createTestVenueHost();
    const venue = demoVenue();
    const instance = await h.mount(venue);
    expect(h.host.stage.listeners).toBe(1);
    h.frame(1 / 60);
    h.setPaused(true);
    h.frame(1 / 60);
    h.setPaused(false);
    h.frame(1 / 60, 0.5);
    expect(venue.frames()).toBe(2);
    h.setMuted(true);
    h.host.audio.play("silent");
    expect(h.log.cues).toEqual(["enter"]);
    expect(h.host.audio.muted.value).toBe(true);
    await instance.unmount();
    expect(h.host.stage.listeners).toBe(0);
    h.host.exit("done");
    expect(h.log.exits).toEqual(["done"]);
  });

  it("regrows lost pixels: quote, confirm, debit, heal", async () => {
    const lost = fromIndices([5 * 16 + 5, 5 * 16 + 6]);
    const h = createTestVenueHost({ identity: { mode: "owner", friend: testFriendView({ lost }), loaned: false } });
    const action = { kind: "regrow" as const, tokenId: "344030", pixels: lost };
    const q = await h.host.economy.quote(action);
    expect(q).toEqual(quote(action));
    const r = await h.host.economy.request(action);
    expect(r.scars.lost).toBe(EMPTY_MASK);
    expect(r.balanceMicro).toBe(20_000_000 - 1_000_000);
    expect(h.balanceMicro).toBe(19_000_000);
    expect(h.host.identity.friend.pub.scars.version).toBe(1);
    expect(h.log.receipts).toHaveLength(1);
  });

  it("rejects guests, other payers, non-lost pixels, poor Friends and cancelled confirms", async () => {
    const lost = fromIndices([5 * 16 + 5]);
    const regrow = { kind: "regrow" as const, tokenId: "344030", pixels: lost };
    const guest = createTestVenueHost({ identity: { mode: "guest", friend: testFriendView({ lost }), loaned: true } });
    await expectHostError(guest.host.economy.request(regrow), "guest_forbidden");
    const owner = () => ({ mode: "owner" as const, friend: testFriendView({ lost }), loaned: false });
    await expectHostError(
      createTestVenueHost({ identity: owner() }).host.economy.request({ ...regrow, tokenId: "1" }),
      "not_owner",
    );
    await expectHostError(
      createTestVenueHost({ identity: owner() }).host.economy.request({ ...regrow, pixels: fromIndices([0]) }),
      "not_lost",
    );
    await expectHostError(
      createTestVenueHost({ identity: owner(), balanceMicro: 1 }).host.economy.request(regrow),
      "insufficient_funds",
    );
    const cancelled = createTestVenueHost({ identity: owner(), confirm: () => false });
    await expectHostError(cancelled.host.economy.request(regrow), "cancelled");
    expect(cancelled.balanceMicro).toBe(20_000_000);
    await expect(
      guest.mount({ ...demoVenue(), manifest: { ...manifest, requires: { ownedFriend: true } } }),
    ).rejects.toBeInstanceOf(TestHostError);
  });

  it("mends another Friend without touching the payer's scars", async () => {
    const h = createTestVenueHost();
    const r = await h.host.economy.request({ kind: "mend", payer: "344030", target: "9", pixels: fromIndices([1]) });
    expect(r.quote.toTargetMicro).toBe(500_000);
    expect(r.scars.version).toBe(0);
    expect(h.balanceMicro).toBe(19_000_000);
  });

  it("applies reported scars like the server (front mask + floor) and regrows over time", async () => {
    const h = createTestVenueHost();
    const front = frontMask(h.host.identity.friend.appearance);
    const claimed: RunSummary = { score: 1, lostDelta: front, recovered: 0, smashed: 0, ticks: 3600, finalHash: "x" };
    const ack = await h.host.reportResult({
      venueId: "demo",
      runId: "r1",
      seed: h.host.seeds.free(),
      kind: "free",
      inputs: new Uint8Array(),
      claimed,
    });
    expect(ack.applied).toBe(true);
    expect(popcount(ack.scars?.lost ?? EMPTY_MASK)).toBe(18);
    const lostAtRunEnd = ack.scars?.lost ?? EMPTY_MASK;
    const pixel = await h.host.economy.quote({ kind: "regrow", tokenId: "344030", pixels: lostAtRunEnd });
    expect(pixel.totalMicro).toBe(9_000_000);
    h.advance(2 * 3_600_000);
    // One pixel regrew for free, so paying for all 18 is refused.
    await expectHostError(
      h.host.economy.request({ kind: "regrow", tokenId: "344030", pixels: lostAtRunEnd }),
      "not_lost",
    );
    expect(h.now).toBe(1_800_000_000_000 + 7_200_000);
    expect(() => h.advance(-1)).toThrow(RangeError);

    const guest = createTestVenueHost({
      identity: { mode: "guest", friend: testFriendView({ loaned: true }), loaned: true },
    });
    const gAck = await guest.host.reportResult({
      venueId: "demo",
      runId: "g1",
      seed: 1,
      kind: "free",
      inputs: new Uint8Array(),
      claimed,
    });
    expect(gAck).toEqual({ runId: "g1", verified: "pending", applied: false, reason: "guest", scars: null });
  });

  it("serves deterministic seeds", async () => {
    const a = createTestVenueHost({ freeSeed: 7 });
    const b = createTestVenueHost({ freeSeed: 7 });
    expect([a.host.seeds.free(), a.host.seeds.free()]).toEqual([b.host.seeds.free(), b.host.seeds.free()]);
    expect(await a.host.seeds.daily()).toMatchObject({ day: "2026-09-30", seed: 42 });
    const custom = createTestVenueHost({
      dailySeed: { day: "2026-10-01", seed: 1, endsAt: 2 },
      reducedMotion: true,
      quality: "low",
    });
    expect(await custom.host.seeds.daily()).toEqual({ day: "2026-10-01", seed: 1, endsAt: 2 });
    expect(custom.host.reducedMotion).toBe(true);
    expect(custom.host.stage.quality).toBe("low");
  });

  it("does not mutate the caller's identity object", async () => {
    const lost = fromIndices([5 * 16 + 5]);
    const identity = { mode: "owner" as const, friend: testFriendView({ lost }), loaned: false };
    const h = createTestVenueHost({ identity });
    await h.host.economy.request({ kind: "regrow", tokenId: "344030", pixels: lost });
    expect(identity.friend.pub.scars.lost).toBe(lost);
  });
});
