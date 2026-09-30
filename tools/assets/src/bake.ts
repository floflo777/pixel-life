/**
 * Reads loaner Friends through the FriendSDK's own public artwork reader (`createFriendReader`: public RPC, no
 * wallet, chain id checked by the SDK) and converts them to `FriendAppearance`s.
 */
import { createFriendReader, GENERATION_SPRITE_MANIFEST } from "@rarefriends/friendsdk/sprites";
import { fromSdkFrames, parseFamilyId, tokenIdFromBigInt, tokenIdToBigInt, type TokenIdStr } from "@pl/shared";
import type { LoanerFriend, LoanersFile } from "./loaners.js";

/** The subset of the SDK reader the bake uses (injectable for tests). */
export interface SpriteReader {
  read(tokenId: bigint): Promise<{ tokenId: bigint; familyId: number; seed: number; frames: readonly bigint[] }>;
}

/** Where the baked art comes from, recorded in the file. */
export const BAKE_SOURCE: LoanersFile["source"] = {
  chainId: GENERATION_SPRITE_MANIFEST.chainId,
  registry: GENERATION_SPRITE_MANIFEST.registry,
  reader: "@rarefriends/friendsdk@0.1.4 createFriendReader",
};

async function withRetry<T>(what: string, attempts: number, f: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let k = 0; k < attempts; k++) {
    try {
      return await f();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400 * (k + 1)));
    }
  }
  throw new Error(`${what} failed after ${attempts} attempts`, { cause: last });
}

/** Reads each loaner sequentially (gentle on the public RPC), retrying transient failures. */
export async function bakeLoaners(
  loaners: readonly { tokenId: TokenIdStr; label?: string }[],
  reader: SpriteReader = createFriendReader(),
  attempts = 3,
): Promise<LoanerFriend[]> {
  const out: LoanerFriend[] = [];
  for (const { tokenId, label } of loaners) {
    const s = await withRetry(`read #${tokenId}`, attempts, () => reader.read(tokenIdToBigInt(tokenId)));
    out.push({
      appearance: {
        tokenId: tokenIdFromBigInt(s.tokenId),
        familyId: parseFamilyId(s.familyId),
        seed: s.seed,
        frames: fromSdkFrames(s.frames),
      },
      ...(label === undefined ? {} : { label }),
    });
  }
  return out;
}
