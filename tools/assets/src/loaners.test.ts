import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FAMILIES, familyName } from "@pl/shared";
import { designWorld, FIXTURE_OWNERS, redirectFetch, startMockRpc, type MockRpcServer } from "@pl/mock-rpc";
import { BAKE_SOURCE, bakeLoaners } from "./bake.js";
import {
  encodeLoaners,
  LOANERS,
  LOANERS_MAX_BYTES,
  parseLoaners,
  stringifyLoaners,
  verifyAgainstDesign,
  type DesignFriendJson,
} from "./loaners.js";

const committedText = readFileSync(new URL("../out/loaners.json", import.meta.url), "utf8");
const design = JSON.parse(
  readFileSync(new URL("../../../docs/design/data/friends.json", import.meta.url), "utf8"),
) as DesignFriendJson[];

describe("committed loaners.json", () => {
  const loaners = parseLoaners(JSON.parse(committedText));

  it("is within budget, covers every family and includes Mismir", () => {
    expect(Buffer.byteLength(committedText)).toBeLessThanOrEqual(LOANERS_MAX_BYTES);
    expect(loaners.map((l) => l.appearance.tokenId)).toEqual(LOANERS.map((l) => l.tokenId));
    expect(new Set(loaners.map((l) => familyName(l.appearance.familyId)))).toEqual(new Set(FAMILIES));
    expect(loaners.find((l) => l.label === "Mismir")?.appearance.tokenId).toBe("344030");
  });

  it("matches the design fixtures frame for frame", () => {
    const r = verifyAgainstDesign(loaners, design);
    expect(r.mismatched).toEqual([]);
    expect(r.verified).toHaveLength(LOANERS.length);
  });

  it("round-trips byte-identically", async () => {
    expect(await stringifyLoaners(encodeLoaners(loaners, BAKE_SOURCE))).toBe(committedText);
  });
});

describe("parseLoaners", () => {
  const good = JSON.parse(committedText) as { friends: Record<string, unknown>[] };
  const bad = (patch: (f: Record<string, unknown>) => void): unknown => {
    const copy = structuredClone(good);
    patch(copy.friends[0] as Record<string, unknown>);
    return copy;
  };

  it("rejects malformed files", () => {
    expect(() => parseLoaners(null)).toThrow(TypeError);
    expect(() => parseLoaners({ ...good, format: "pl-loaners@0" })).toThrow(/format/);
    expect(() => parseLoaners(bad((f) => (f.tokenId = "0")))).toThrow(/tokenId/);
    expect(() => parseLoaners(bad((f) => (f.familyId = 3)))).toThrow(/familyId/);
    expect(() => parseLoaners(bad((f) => (f.frames = [0])))).toThrow(/64/);
    expect(() => parseLoaners(bad((f) => ((f.frames as number[])[5] = 999)))).toThrow(/out-of-range/);
    expect(() => parseLoaners(bad((f) => ((f.masks as string[])[0] = "xyz")))).toThrow(/masks/);
  });

  it("reports frame mismatches", () => {
    const loaners = parseLoaners(JSON.parse(committedText));
    const first = loaners[0];
    if (!first) throw new Error("empty");
    const frames = [...first.appearance.frames];
    frames[7] = "f".repeat(64);
    const r = verifyAgainstDesign([{ appearance: { ...first.appearance, frames } }], design);
    expect(r.mismatched).toEqual([{ tokenId: first.appearance.tokenId, frames: [7] }]);
  });
});

describe("bakeLoaners through the SDK reader against the mock chain", () => {
  let rpc: MockRpcServer;
  let restore: () => void = () => undefined;
  beforeEach(async () => {
    rpc = await startMockRpc({
      world: designWorld({ owners: { [FIXTURE_OWNERS.alice]: LOANERS.map((l) => l.tokenId) } }),
    });
    restore = redirectFetch(rpc.url);
  });
  afterEach(async () => {
    restore();
    await rpc.close();
  });

  it("bakes the roster with the same art as the committed file", async () => {
    const baked = await bakeLoaners(LOANERS);
    const committed = parseLoaners(JSON.parse(committedText));
    expect(baked.map((b) => [b.appearance.tokenId, b.appearance.familyId, b.appearance.frames, b.label])).toEqual(
      committed.map((c) => [c.appearance.tokenId, c.appearance.familyId, c.appearance.frames, c.label]),
    );
    expect(verifyAgainstDesign(baked, design).mismatched).toEqual([]);
  });

  it("retries and then fails loudly", async () => {
    let calls = 0;
    const reader = {
      read: () => {
        calls++;
        return Promise.reject(new Error("rpc down"));
      },
    };
    await expect(bakeLoaners([{ tokenId: "1" }], reader, 2)).rejects.toThrow(/read #1 failed after 2 attempts/);
    expect(calls).toBe(2);
  });
});
