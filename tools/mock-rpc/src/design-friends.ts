import { readFileSync } from "node:fs";
import { GENERATION_FAMILY_NAMES } from "@rarefriends/friendsdk/sprites";

/** A real Friend from `docs/design/data/friends.json`: 64 canonical frames as 16x16 bitmaps. */
export interface DesignFriend {
  readonly tokenId: bigint;
  readonly familyId: number;
  readonly familyName: (typeof GENERATION_FAMILY_NAMES)[number];
  /** 64 uint256 bitmaps in registry order (bit 0 = top-left, bit 255 = bottom-right). */
  readonly frames: readonly bigint[];
}

const DATA_URL = new URL("../../../docs/design/data/friends.json", import.meta.url);

/** Encodes 16 rows of `#`/`.` into the registry's uint256 bitmap layout; throws on malformed rows. */
export function encodeSpriteRows(rows: readonly string[]): bigint {
  if (rows.length !== 16) throw new RangeError("A sprite frame has exactly 16 rows.");
  let bitmap = 0n;
  rows.forEach((row, y) => {
    if (row.length !== 16 || !/^[#.]+$/.test(row)) throw new RangeError(`Malformed sprite row ${y}.`);
    for (let x = 0; x < 16; x++) if (row[x] === "#") bitmap |= 1n << BigInt(y * 16 + x);
  });
  return bitmap;
}

function parseDesignFriends(raw: unknown): DesignFriend[] {
  if (!Array.isArray(raw)) throw new TypeError("friends.json must be an array.");
  return raw.map((entry: unknown, index) => {
    if (!entry || typeof entry !== "object") throw new TypeError(`friends.json[${index}] is not an object.`);
    const { tokenId, family, frames } = entry as Record<string, unknown>;
    if (typeof tokenId !== "string" || !/^[1-9]\d*$/.test(tokenId))
      throw new TypeError(`friends.json[${index}].tokenId`);
    const familyId = GENERATION_FAMILY_NAMES.indexOf(family as DesignFriend["familyName"]);
    const familyName = GENERATION_FAMILY_NAMES[familyId];
    if (familyName === undefined) throw new TypeError(`friends.json[${index}].family is unknown.`);
    if (!Array.isArray(frames) || frames.length !== 64) throw new TypeError(`friends.json[${index}] needs 64 frames.`);
    return Object.freeze({
      tokenId: BigInt(tokenId),
      familyId,
      familyName,
      frames: Object.freeze(frames.map((rows: unknown) => encodeSpriteRows(rows as string[]))),
    });
  });
}

let cache: readonly DesignFriend[] | null = null;

/** The 13 real Friends from the design data, parsed once and frozen. */
export function loadDesignFriends(): readonly DesignFriend[] {
  cache ??= Object.freeze(parseDesignFriends(JSON.parse(readFileSync(DATA_URL, "utf8"))));
  return cache;
}
