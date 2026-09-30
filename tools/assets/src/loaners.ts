/**
 * Loaner Friends (D-11): real Friends baked at build time so guests can play without a wallet. This module owns the
 * roster, the compact on-disk format (`out/loaners.json`), its parser and the check against the design fixtures.
 * Pure: no IO, no network.
 */
import {
  familyIdFromName,
  familyName,
  FAMILIES,
  fromRows,
  isHex64,
  isTokenIdStr,
  type FamilyId,
  type FriendAppearance,
  type Hex64,
  type TokenIdStr,
} from "@pl/shared";

/** One loaner per family (the Mask one is #344030 "Mismir", the Friend of the style frames) plus 3 spares: 12. */
export const LOANERS: readonly { tokenId: TokenIdStr; label?: string }[] = Object.freeze([
  { tokenId: "344030", label: "Mismir" },
  { tokenId: "63675" }, // Skeleton
  { tokenId: "65058" }, // Family
  { tokenId: "344034" }, // Cellular
  { tokenId: "344033" }, // Asymmetry
  { tokenId: "65042" }, // Hoverer
  { tokenId: "64998" }, // Colossus
  { tokenId: "65040" }, // Sparkling
  { tokenId: "64940" }, // Hollow
  { tokenId: "63713" }, // Mask
  { tokenId: "64981" }, // Cellular
  { tokenId: "64978" }, // Asymmetry
]);

/** Format tag of `loaners.json`; bump on any incompatible change. */
export const LOANERS_FORMAT = "pl-loaners@1";
/** Size budget of `loaners.json` in bytes. */
export const LOANERS_MAX_BYTES = 60 * 1024;

/** A baked loaner: the Friend's on-chain appearance and an optional display label. */
export interface LoanerFriend {
  appearance: FriendAppearance;
  label?: string;
}

/** One Friend on disk: its distinct frame masks and 64 indices into them (idle holds repeat a lot). */
interface LoanerRecord {
  tokenId: TokenIdStr;
  familyId: FamilyId;
  family: string;
  seed: number;
  label?: string;
  masks: Hex64[];
  frames: number[];
}

/** The whole file. */
export interface LoanersFile {
  format: typeof LOANERS_FORMAT;
  source: { chainId: number; registry: string; reader: string };
  friends: LoanerRecord[];
}

/** Encodes loaners into the on-disk format (deterministic: same Friends → byte-identical JSON). */
export function encodeLoaners(friends: readonly LoanerFriend[], source: LoanersFile["source"]): LoanersFile {
  return {
    format: LOANERS_FORMAT,
    source,
    friends: friends.map(({ appearance: a, label }) => {
      const masks: Hex64[] = [];
      const frames = a.frames.map((m) => {
        const k = masks.indexOf(m);
        if (k >= 0) return k;
        masks.push(m);
        return masks.length - 1;
      });
      return {
        tokenId: a.tokenId,
        familyId: a.familyId,
        family: familyName(a.familyId),
        seed: a.seed,
        ...(label === undefined ? {} : { label }),
        masks,
        frames,
      };
    }),
  };
}

/**
 * Serialises a loaners file with the repo's Prettier settings, so the committed file passes `format:check` and a
 * re-bake of unchanged art is byte-identical.
 */
export async function stringifyLoaners(file: LoanersFile): Promise<string> {
  const prettier = await import("prettier");
  const config = (await prettier.resolveConfig(new URL("../out/loaners.json", import.meta.url))) ?? {};
  return prettier.format(JSON.stringify(file), { ...config, parser: "json" });
}

function fail(msg: string): never {
  throw new TypeError(`loaners.json: ${msg}`);
}

/** Parses and validates `loaners.json` (from `import` or `fetch`); throws `TypeError` on any malformed field. */
export function parseLoaners(json: unknown): LoanerFriend[] {
  if (!json || typeof json !== "object") fail("not an object");
  const file = json as Partial<LoanersFile>;
  if (file.format !== LOANERS_FORMAT) fail(`unsupported format ${String(file.format)}`);
  if (!Array.isArray(file.friends)) fail("friends must be an array");
  return file.friends.map((raw: unknown, i) => {
    const f = raw as Partial<LoanerRecord>;
    if (!f || typeof f !== "object") fail(`friends[${i}] is not an object`);
    if (!isTokenIdStr(f.tokenId)) fail(`friends[${i}].tokenId`);
    if (typeof f.family !== "string" || !(FAMILIES as readonly string[]).includes(f.family))
      fail(`friends[${i}].family`);
    const familyId = familyIdFromName(f.family);
    if (f.familyId !== familyId) fail(`friends[${i}].familyId does not match family`);
    if (!Number.isInteger(f.seed) || (f.seed as number) < 0 || (f.seed as number) > 0xffffffff)
      fail(`friends[${i}].seed`);
    if (!Array.isArray(f.masks) || !f.masks.every(isHex64)) fail(`friends[${i}].masks`);
    const masks = f.masks;
    if (!Array.isArray(f.frames) || f.frames.length !== 64) fail(`friends[${i}].frames must have 64 entries`);
    const frames = f.frames.map((k) => {
      const m = Number.isInteger(k) ? masks[k] : undefined;
      if (m === undefined) fail(`friends[${i}].frames has an out-of-range index`);
      return m;
    });
    if (f.label !== undefined && typeof f.label !== "string") fail(`friends[${i}].label`);
    return {
      appearance: { tokenId: f.tokenId, familyId, seed: f.seed as number, frames },
      ...(f.label === undefined ? {} : { label: f.label }),
    };
  });
}

/** A Friend of `docs/design/data/friends.json`. */
export interface DesignFriendJson {
  tokenId: string;
  family: string;
  frames: string[][];
}

/** Result of comparing baked frames with the design fixtures. */
export interface VerifyReport {
  verified: TokenIdStr[];
  unverified: TokenIdStr[];
  mismatched: { tokenId: TokenIdStr; family?: boolean; frames: number[] }[];
}

/**
 * Compares every baked Friend present in the design fixtures frame by frame (and family). Friends absent from the
 * fixtures are listed as unverified; any difference is a mismatch.
 */
export function verifyAgainstDesign(
  friends: readonly LoanerFriend[],
  design: readonly DesignFriendJson[],
): VerifyReport {
  const byId = new Map(design.map((d) => [d.tokenId, d]));
  const report: VerifyReport = { verified: [], unverified: [], mismatched: [] };
  for (const { appearance: a } of friends) {
    const d = byId.get(a.tokenId);
    if (!d) {
      report.unverified.push(a.tokenId);
      continue;
    }
    const frames: number[] = [];
    for (let k = 0; k < 64; k++) {
      const rows = d.frames[k];
      if (!rows || fromRows(rows) !== a.frames[k]) frames.push(k);
    }
    const family = d.family !== familyName(a.familyId);
    if (frames.length > 0 || family)
      report.mismatched.push({ tokenId: a.tokenId, ...(family ? { family } : {}), frames });
    else report.verified.push(a.tokenId);
  }
  return report;
}
