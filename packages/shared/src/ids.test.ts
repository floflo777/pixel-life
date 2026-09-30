import fc from "fast-check";
import { GENERATION_FAMILY_NAMES } from "@rarefriends/friendsdk/sprites";
import { describe, expect, it } from "vitest";
import {
  COLOSSUS_FAMILY_ID,
  FAMILIES,
  familyIdFromName,
  familyName,
  isFamilyId,
  isHex64,
  isTokenIdStr,
  parseFamilyId,
  parseHex64,
  parseTokenId,
  tokenIdFromBigInt,
  tokenIdToBigInt,
  UINT256_MAX,
} from "./ids.js";

describe("token ids", () => {
  it("accepts canonical decimal uint256 strings only", () => {
    expect(isTokenIdStr("1")).toBe(true);
    expect(isTokenIdStr("344030")).toBe(true);
    expect(isTokenIdStr(UINT256_MAX.toString())).toBe(true);
    for (const bad of ["0", "01", "-1", "1.5", "", " 1", "0x10", (UINT256_MAX + 1n).toString(), 1, null]) {
      expect(isTokenIdStr(bad)).toBe(false);
    }
  });

  it("parses bigint, number and string forms", () => {
    expect(parseTokenId(344030n)).toBe("344030");
    expect(parseTokenId(7)).toBe("7");
    expect(parseTokenId("65042")).toBe("65042");
    expect(() => parseTokenId(0)).toThrow(RangeError);
    expect(() => parseTokenId(1.5)).toThrow(RangeError);
    expect(() => parseTokenId("abc")).toThrow(RangeError);
    expect(() => tokenIdFromBigInt(0n)).toThrow(RangeError);
    expect(() => tokenIdFromBigInt(UINT256_MAX + 1n)).toThrow(RangeError);
    expect(() => tokenIdToBigInt("007")).toThrow(RangeError);
  });

  it("round-trips through bigint", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: UINT256_MAX }), (v) => {
        const s = tokenIdFromBigInt(v);
        expect(isTokenIdStr(s)).toBe(true);
        expect(tokenIdToBigInt(s)).toBe(v);
      }),
    );
  });
});

describe("Hex64", () => {
  it("is 64 lowercase hex chars without prefix", () => {
    expect(isHex64("0".repeat(64))).toBe(true);
    expect(isHex64("F".repeat(64))).toBe(false);
    expect(isHex64("0".repeat(63))).toBe(false);
    expect(isHex64(`0x${"0".repeat(64)}`)).toBe(false);
    expect(isHex64(42)).toBe(false);
  });

  it("normalises prefix and case, rejecting anything else", () => {
    expect(parseHex64(`0x${"AB".repeat(32)}`)).toBe("ab".repeat(32));
    expect(parseHex64(`0X${"0".repeat(64)}`)).toBe("0".repeat(64));
    expect(() => parseHex64("g".repeat(64))).toThrow(RangeError);
    expect(() => parseHex64(1)).toThrow(RangeError);
  });
});

describe("families", () => {
  it("match the SDK registry order", () => {
    expect([...FAMILIES]).toEqual([...GENERATION_FAMILY_NAMES]);
    expect(FAMILIES[COLOSSUS_FAMILY_ID]).toBe("Colossus");
  });

  it("map names and ids both ways", () => {
    FAMILIES.forEach((name, id) => {
      expect(familyIdFromName(name)).toBe(id);
      expect(familyName(parseFamilyId(id))).toBe(name);
    });
    expect(() => familyIdFromName("Dragon")).toThrow(RangeError);
    expect(isFamilyId(9)).toBe(false);
    expect(isFamilyId(-1)).toBe(false);
    expect(isFamilyId(1.5)).toBe(false);
    expect(() => parseFamilyId("1")).toThrow(RangeError);
  });
});
