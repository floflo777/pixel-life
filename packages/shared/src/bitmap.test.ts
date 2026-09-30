import fc from "fast-check";
import { decodeSpriteBitmap } from "@rarefriends/friendsdk/sprites";
import { describe, expect, it } from "vitest";
import { FRIEND_FIXTURES } from "./__fixtures__/friends.js";
import {
  and,
  andNot,
  boundary,
  EMPTY_MASK,
  FULL_MASK,
  fromIndices,
  fromRows,
  fromSdkBitmap,
  fromSdkFrame,
  fromSdkFrames,
  getBit,
  isEmpty,
  isSubset,
  not,
  or,
  pixelIndex,
  pixelXY,
  popcount,
  setBit,
  toIndices,
  toRows,
  toSdkBitmap,
  xor,
} from "./bitmap.js";
import { UINT256_MAX } from "./ids.js";

const mask = fc.bigInt({ min: 0n, max: UINT256_MAX }).map(fromSdkBitmap);
const index = fc.integer({ min: 0, max: 255 });

describe("bit order (SDK decodeSpriteBitmap)", () => {
  it("bit 0 is the top-left pixel and bit 255 the bottom-right", () => {
    expect(toRows(fromIndices([0]))[0]).toBe("#...............");
    expect(toRows(fromIndices([255]))[15]).toBe("...............#");
    expect(toRows(fromIndices([pixelIndex(3, 2)]))[2]).toBe("...#............");
    expect(fromIndices([0])).toBe(`${"0".repeat(63)}1`);
    expect(toSdkBitmap(fromIndices([255]))).toBe(1n << 255n);
  });

  it("toRows equals SDK decodeSpriteBitmap rows for any bitmap", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: UINT256_MAX }), (b) => {
        expect(toRows(fromSdkBitmap(b))).toEqual([...decodeSpriteBitmap(b).rows]);
        expect(fromSdkFrame(decodeSpriteBitmap(b))).toBe(fromSdkBitmap(b));
      }),
    );
  });

  it("every friends.json frame round-trips rows -> Hex64 -> SDK bitmap -> SDK rows", () => {
    expect(FRIEND_FIXTURES).toHaveLength(13);
    for (const f of FRIEND_FIXTURES) {
      expect(f.frames).toHaveLength(64);
      const masks = f.frames.map(fromRows);
      expect(fromSdkFrames(masks.map(toSdkBitmap))).toEqual(masks);
      masks.forEach((m, i) => {
        expect(decodeSpriteBitmap(toSdkBitmap(m)).rows).toEqual(f.frames[i]);
        expect(toRows(m)).toEqual(f.frames[i]);
      });
    }
  });

  it("known pixel counts of real Friends (tokenomics: 42-92 px)", () => {
    const n0 = (id: string) => popcount(fromRows(FRIEND_FIXTURES.find((f) => f.tokenId === id)?.frames[0] ?? []));
    expect(n0("344030")).toBe(82);
    expect(n0("65042")).toBe(42);
    expect(n0("63675")).toBe(92);
  });
});

describe("conversions", () => {
  it("rejects malformed rows, bitmaps and frame lists", () => {
    expect(() => fromRows([])).toThrow(RangeError);
    expect(() => fromRows(Array.from({ length: 16 }, () => "."))).toThrow(RangeError);
    expect(() => fromRows(Array.from({ length: 16 }, () => "x".repeat(16)))).toThrow(RangeError);
    expect(() => fromSdkBitmap(-1n)).toThrow(RangeError);
    expect(() => fromSdkBitmap(UINT256_MAX + 1n)).toThrow(RangeError);
    expect(() => fromSdkFrames([0n])).toThrow(RangeError);
    expect(() => popcount("xyz")).toThrow(RangeError);
    expect(() => toSdkBitmap("nope")).toThrow(RangeError);
  });

  it("rows, indices and bitmaps round-trip", () => {
    fc.assert(
      fc.property(mask, (m) => {
        expect(fromRows(toRows(m))).toBe(m);
        expect(fromIndices(toIndices(m))).toBe(m);
        expect(fromSdkBitmap(toSdkBitmap(m))).toBe(m);
        expect(toIndices(m)).toHaveLength(popcount(m));
      }),
    );
  });

  it("pixelIndex and pixelXY are inverse and bounds-checked", () => {
    fc.assert(
      fc.property(index, (i) => {
        expect(pixelIndex(...pixelXY(i))).toBe(i);
      }),
    );
    expect(() => pixelIndex(16, 0)).toThrow(RangeError);
    expect(() => pixelIndex(0, -1)).toThrow(RangeError);
    expect(() => pixelXY(256)).toThrow(RangeError);
    expect(() => fromIndices([256])).toThrow(RangeError);
  });
});

describe("boolean algebra", () => {
  it("popcount of the constants", () => {
    expect(popcount(EMPTY_MASK)).toBe(0);
    expect(popcount(FULL_MASK)).toBe(256);
    expect(isEmpty(EMPTY_MASK)).toBe(true);
    expect(isEmpty(FULL_MASK)).toBe(false);
  });

  it("matches bigint semantics", () => {
    fc.assert(
      fc.property(mask, mask, (a, b) => {
        const A = toSdkBitmap(a);
        const B = toSdkBitmap(b);
        expect(toSdkBitmap(and(a, b))).toBe(A & B);
        expect(toSdkBitmap(or(a, b))).toBe(A | B);
        expect(toSdkBitmap(xor(a, b))).toBe(A ^ B);
        expect(toSdkBitmap(andNot(a, b))).toBe(A & ~B & UINT256_MAX);
        expect(toSdkBitmap(not(a))).toBe(~A & UINT256_MAX);
      }),
    );
  });

  it("popcount is additive over disjoint parts and subset is consistent", () => {
    fc.assert(
      fc.property(mask, mask, (a, b) => {
        expect(popcount(a)).toBe(popcount(and(a, b)) + popcount(andNot(a, b)));
        expect(popcount(or(a, b))).toBe(popcount(a) + popcount(b) - popcount(and(a, b)));
        expect(isSubset(and(a, b), a)).toBe(true);
        expect(isSubset(a, or(a, b))).toBe(true);
        expect(isSubset(a, b)).toBe(andNot(a, b) === EMPTY_MASK);
      }),
    );
  });

  it("getBit / setBit agree with indices", () => {
    fc.assert(
      fc.property(mask, index, fc.boolean(), (m, i, on) => {
        const n = setBit(m, i, on);
        expect(getBit(n, i)).toBe(on);
        expect(getBit(m, i)).toBe(toIndices(m).includes(i));
        expect(andNot(xor(m, n), fromIndices([i]))).toBe(EMPTY_MASK);
      }),
    );
  });
});

describe("boundary", () => {
  it("is the outline of a solid block and a subset of the input", () => {
    const block: number[] = [];
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) block.push(pixelIndex(x, y));
    const b = boundary(fromIndices(block));
    expect(popcount(b)).toBe(12);
    expect(getBit(b, pixelIndex(5, 5))).toBe(false);
    expect(boundary(FULL_MASK)).toBe(boundary(FULL_MASK));
    expect(popcount(boundary(FULL_MASK))).toBe(60);
    fc.assert(
      fc.property(mask, (m) => {
        expect(isSubset(boundary(m), m)).toBe(true);
      }),
    );
  });
});
