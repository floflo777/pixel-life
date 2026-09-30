/**
 * Identifier types shared by every package: Friend token ids, 256-bit pixel masks and families.
 *
 * Both `TokenIdStr` and `Hex64` are plain string aliases (as specified in architecture §2.1) so that DTOs
 * stay JSON-native; use the guards/parsers below at every trust boundary.
 */

/** Largest uint256, the upper bound of an ERC-721 token id and of a 16x16 sprite bitmap. */
export const UINT256_MAX = (1n << 256n) - 1n;

/** A Friend token id as a canonical decimal uint256 string (1..2^256-1, no sign, no leading zeros). `bigint` only at the SDK boundary. */
export type TokenIdStr = string;

/**
 * A 256-bit pixel mask as exactly 64 lowercase hex chars (no `0x`), i.e. the big-endian hex of the SDK's uint256 sprite
 * bitmap. Bit i is pixel (x = i % 16, y = i >> 4); bit 0 is the top-left pixel, exactly like SDK `decodeSpriteBitmap`.
 */
export type Hex64 = string;

/** Friend family names in registry order: `FAMILIES[familyId]` equals SDK `GENERATION_FAMILY_NAMES[familyId]`. */
export const FAMILIES = [
  "Skeleton",
  "Mask",
  "Family",
  "Cellular",
  "Asymmetry",
  "Hoverer",
  "Colossus",
  "Sparkling",
  "Hollow",
] as const;

/** A family name as returned by the registry's `familyName(id)`. */
export type FamilyName = (typeof FAMILIES)[number];

/** A registry family id: the index of the family in `FAMILIES`. */
export type FamilyId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** The Colossus family id: it has no up/down frames, so the SDK falls back to side frames. */
export const COLOSSUS_FAMILY_ID = 6 satisfies FamilyId;

const TOKEN_ID_RE = /^[1-9][0-9]{0,77}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/** True iff `v` is a canonical decimal token id within 1..2^256-1. */
export function isTokenIdStr(v: unknown): v is TokenIdStr {
  return typeof v === "string" && TOKEN_ID_RE.test(v) && BigInt(v) <= UINT256_MAX;
}

/** Returns `v` as a canonical `TokenIdStr` or throws a `RangeError`; accepts a bigint or a positive safe integer too. */
export function parseTokenId(v: unknown): TokenIdStr {
  if (typeof v === "bigint") return tokenIdFromBigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return String(v);
  if (isTokenIdStr(v)) return v;
  throw new RangeError("Token id must be a decimal integer from 1 through uint256 max.");
}

/** Converts an SDK bigint token id to its canonical string; throws `RangeError` outside 1..2^256-1. */
export function tokenIdFromBigInt(v: bigint): TokenIdStr {
  if (v < 1n || v > UINT256_MAX) throw new RangeError("Token id must be from 1 through uint256 max.");
  return v.toString(10);
}

/** Converts a validated token id to the bigint the FriendSDK expects; throws `RangeError` on a non-canonical id. */
export function tokenIdToBigInt(id: TokenIdStr): bigint {
  if (!isTokenIdStr(id)) throw new RangeError("Invalid token id.");
  return BigInt(id);
}

/** True iff `v` is a canonical `Hex64` (64 lowercase hex chars, no prefix). */
export function isHex64(v: unknown): v is Hex64 {
  return typeof v === "string" && HEX64_RE.test(v);
}

/** Normalises an optional `0x` prefix and upper case to a canonical `Hex64`; throws `RangeError` on any other input. */
export function parseHex64(v: unknown): Hex64 {
  if (typeof v !== "string") throw new RangeError("A pixel mask must be a string.");
  const body = (v.startsWith("0x") || v.startsWith("0X") ? v.slice(2) : v).toLowerCase();
  if (!HEX64_RE.test(body)) throw new RangeError("A pixel mask must be exactly 64 hex characters.");
  return body;
}

/** True iff `v` is an integer family id 0..8. */
export function isFamilyId(v: unknown): v is FamilyId {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < FAMILIES.length;
}

/** Returns `v` as a `FamilyId` or throws `RangeError`. */
export function parseFamilyId(v: unknown): FamilyId {
  if (!isFamilyId(v)) throw new RangeError("Unknown family id.");
  return v;
}

/** Maps a family name (as in `friends.json` / the registry) to its id; throws `RangeError` on an unknown name. */
export function familyIdFromName(name: string): FamilyId {
  const id = (FAMILIES as readonly string[]).indexOf(name);
  return parseFamilyId(id);
}

/** Returns the registry name of a family id. */
export function familyName(id: FamilyId): FamilyName {
  // Invariant: FamilyId is 0..8 and FAMILIES has 9 entries, so the index is always in range.
  return FAMILIES[id] as FamilyName;
}
