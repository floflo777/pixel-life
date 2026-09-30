import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMPTY_MASK, FULL_MASK } from "./bitmap.js";
import {
  bigIntStrSchema,
  CLIENT_RATES,
  type ClientMsg,
  COORD_MAX,
  COORD_MIN,
  decodeClientFrame,
  decodeServerFrame,
  EMOTES,
  encodeMsg,
  MAX_CLIENT_FRAME,
  MAX_INPUTS_B64,
  parseBigIntStr,
  parseBody,
  parseClientMsg,
  playFromDto,
  QUICK_CHAT_PHRASES,
  ROOM_HARD_CAP,
  ROOM_SOFT_CAP,
  ROOMS,
  SERVER_MSG_TYPES,
  type ServerMsg,
  type ValidatedRoute,
  WS_CLOSE,
} from "./protocol.js";
import { RUN_TICKS } from "./sim-types.js";

const validClient: fc.Arbitrary<ClientMsg> = fc.oneof(
  fc.tuple(
    fc.constant("move" as const),
    fc.integer({ min: 0, max: 0xffffffff }),
    fc.integer({ min: COORD_MIN, max: COORD_MAX }),
    fc.integer({ min: COORD_MIN, max: COORD_MAX }),
  ),
  fc.tuple(fc.constant("emote" as const), fc.integer({ min: 0, max: EMOTES.length - 1 })),
  fc.tuple(fc.constant("say" as const), fc.integer({ min: 0, max: QUICK_CHAT_PHRASES - 1 })),
  fc.tuple(fc.constant("venue" as const), fc.constantFrom("pixel-life", "seed-pack", null)),
  fc.tuple(fc.constant("ping" as const), fc.integer({ min: 0, max: 2 ** 50 })),
);

describe("client messages", () => {
  it("accepts every valid message and round-trips through the wire encoding", () => {
    fc.assert(
      fc.property(validClient, (m) => {
        const frame = encodeMsg(m);
        expect(frame.length).toBeLessThanOrEqual(MAX_CLIENT_FRAME);
        expect(decodeClientFrame(frame)).toEqual({ ok: true, value: m });
      }),
    );
  });

  it("rejects out-of-range, mistyped, extra-arity and unknown messages", () => {
    const bad: unknown[] = [
      ["move", -1, 0, 0],
      ["move", 1, COORD_MAX + 1, 0],
      ["move", 1, 0.5, 0],
      ["move", 1, 0],
      ["move", 1, 0, 0, 0],
      ["emote", EMOTES.length],
      ["say", QUICK_CHAT_PHRASES],
      ["say", "1"],
      ["venue", "Pixel Life"],
      ["venue", "x".repeat(33)],
      ["ping", -1],
      ["ping", Number.POSITIVE_INFINITY],
      ["teleport", 0, 0],
      ["__proto__"],
      { 0: "ping", 1: 1 },
      "ping",
      null,
    ];
    for (const b of bad) expect(parseClientMsg(b).ok).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (s) => {
        const r = decodeClientFrame(s);
        expect(typeof r.ok).toBe("boolean");
      }),
    );
    expect(decodeClientFrame("{")).toEqual({ ok: false, error: "malformed json" });
    expect(decodeClientFrame(`["ping",${"1".repeat(MAX_CLIENT_FRAME)}]`)).toEqual({
      ok: false,
      error: "frame too large",
    });
  });
});

describe("server messages", () => {
  it("decodes known tags and drops unknown or malformed frames", () => {
    const msgs: ServerMsg[] = [
      [
        "welcome",
        "p1",
        [
          {
            id: "p1",
            kind: "owner",
            tokenId: "344030",
            loaned: false,
            x: 0,
            z: 0,
            venue: null,
            scarsHash: "00000000",
            goldHeld: 1,
          },
        ],
        1,
      ],
      ["moved", "p1", 0, 0, 100, -100, 5],
      ["scars", "344030", "deadbeef"],
      ["mended", "344030", "1234", 3],
      [
        "notify",
        {
          id: "n1",
          tokenId: "344030",
          createdAt: 1,
          readAt: null,
          kind: "mended",
          by: "1234",
          px: 1,
          toTargetMicro: 500_000,
          mode: "sim",
          region: "left ear",
          batched: 0,
        },
      ],
      ["kick", WS_CLOSE.rateLimited],
    ];
    for (const m of msgs) expect(decodeServerFrame(encodeMsg(m))).toEqual(m);
    expect(decodeServerFrame('["nope"]')).toBeNull();
    expect(decodeServerFrame("{}")).toBeNull();
    expect(decodeServerFrame("not json")).toBeNull();
    expect(new Set(SERVER_MSG_TYPES).size).toBe(12);
  });
});

describe("hub constants", () => {
  it("match architecture §1b.1 and GDD §11", () => {
    expect(ROOMS).toContain("plaza");
    expect(ROOM_SOFT_CAP).toBe(40);
    expect(ROOM_HARD_CAP).toBe(60);
    expect(EMOTES).toHaveLength(8);
    expect(CLIENT_RATES.move).toEqual({ perSec: 8, burst: 16 });
    expect(CLIENT_RATES.say.perSec).toBe(0.5);
    expect(WS_CLOSE.rateLimited).toBe(4008);
  });
});

describe("REST request schemas", () => {
  const claimed = { score: 1200, lostDelta: EMPTY_MASK, recovered: 3, smashed: 2, ticks: RUN_TICKS, finalHash: "ab12" };
  const run = { venueId: "pixel-life", kind: "free", seed: 42, inputs: "AAEC", claimed };

  it("accepts well-formed bodies", () => {
    expect(parseBody("POST /api/runs", run)).toEqual({ ok: true, value: run });
    expect(parseBody("POST /api/runs", { ...run, kind: "daily", day: "2026-09-30" }).ok).toBe(true);
    expect(parseBody("POST /api/session/friend", { tokenId: "344030" }).ok).toBe(true);
    expect(parseBody("POST /api/economy/quote", { kind: "regrow", tokenId: "1", pixels: FULL_MASK }).ok).toBe(true);
    expect(
      parseBody("POST /api/economy/mend", {
        action: { kind: "mend", payer: "1", target: "2", pixels: FULL_MASK },
        quoteId: "q1",
        txHash: `0x${"a".repeat(64)}`,
      }).ok,
    ).toBe(true);
    expect(parseBody("POST /api/auth/verify", { message: "hi", signature: "0xabcd" }).ok).toBe(true);
    expect(parseBody("POST /api/seedpack/read", {}).ok).toBe(true);
    expect(parseBody("POST /api/seedpack/play", {}).ok).toBe(true);
    expect(parseBody("POST /api/seedpack/redeem", { outcomeId: 4, quantity: "1" }).ok).toBe(true);
    expect(parseBody("GET /api/sky", { room: "plaza" }).ok).toBe(true);
    expect(parseBody("GET /api/daily/:day/board", { board: "visitors" }).ok).toBe(true);
    expect(parseBody("POST /api/inbox/read", { all: true }).ok).toBe(true);
    expect(parseBody("POST /api/inbox/read", { ids: ["a", "b"] }).ok).toBe(true);
  });

  it("rejects malformed bodies with a readable error", () => {
    const cases: [ValidatedRoute, unknown][] = [
      ["POST /api/runs", { ...run, kind: "daily" }],
      ["POST /api/runs", { ...run, inputs: "not base64!" }],
      ["POST /api/runs", { ...run, inputs: "A".repeat(MAX_INPUTS_B64 + 4) }],
      ["POST /api/runs", { ...run, claimed: { ...claimed, ticks: RUN_TICKS + 1 } }],
      ["POST /api/runs", { ...run, claimed: { ...claimed, lostDelta: "0x00" } }],
      ["POST /api/runs", { ...run, day: undefined }],
      ["POST /api/session/friend", { tokenId: 344030 }],
      ["POST /api/economy/quote", { kind: "burn", tokenId: "1", pixels: FULL_MASK }],
      ["POST /api/economy/regrow", { action: { kind: "regrow", tokenId: "1", pixels: FULL_MASK }, txHash: "0x12" }],
      ["POST /api/auth/verify", { message: "", signature: "0xabcd" }],
      ["POST /api/seedpack/read", { extra: 1 }],
      ["POST /api/seedpack/buy", { quantity: "-1" }],
      ["POST /api/seedpack/redeem", { outcomeId: 0, quantity: "1" }],
      ["GET /api/sky", { room: "moon" }],
      ["POST /api/inbox/read", { ids: Array.from({ length: 101 }, () => "a") }],
      ["POST /api/inbox/read", { all: false }],
    ];
    for (const [route, body] of cases) {
      const r = parseBody(route, body);
      expect(r.ok, `${route} ${JSON.stringify(body)}`).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });
});

describe("bigint strings", () => {
  it("parse canonical non-negative decimals only", () => {
    expect(parseBigIntStr("0")).toBe(0n);
    expect(parseBigIntStr("45000000000000000000")).toBe(45n * 10n ** 18n);
    for (const bad of ["", "-1", "01", "1e3", " 1"]) expect(() => parseBigIntStr(bad)).toThrow(RangeError);
    expect(bigIntStrSchema.safeParse("1".repeat(79)).success).toBe(false);
    expect(playFromDto({ id: "3", outcomeId: null })).toEqual({ id: 3n, outcomeId: null });
  });
});
