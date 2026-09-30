/**
 * Sign-In with Ethereum (architecture §1.6 step 2): an EIP-4361 message for our host on chain 4663, signed with
 * `personal_sign` through the SDK wallet session's provider. A signature, never a transaction.
 */
import { type Address, stringToHex } from "viem";
import { createSiweMessage } from "viem/siwe";

/** The statement shown in the wallet (the UI repeats it). */
export const SIWE_STATEMENT = "Sign in to Pixel Life. No transaction, no cost.";
/** Message lifetime; the server additionally bounds it by the nonce TTL. */
export const SIWE_TTL_MS = 10 * 60 * 1000;

/** Inputs of {@link buildSiweMessage}. */
export interface SiweInput {
  address: Address;
  chainId: number;
  nonce: string;
  /** Page origin, e.g. "https://pixel-life.florent-g.workers.dev". Domain = its host. */
  origin: string;
  now: Date;
}

/** Builds the EIP-4361 message the server verifies (domain = our host, URI = our origin, expiry +10 min). */
export function buildSiweMessage(i: SiweInput): string {
  const url = new URL(i.origin);
  return createSiweMessage({
    address: i.address,
    chainId: i.chainId,
    domain: url.host,
    uri: url.origin,
    nonce: i.nonce,
    version: "1",
    statement: SIWE_STATEMENT,
    issuedAt: i.now,
    expirationTime: new Date(i.now.getTime() + SIWE_TTL_MS),
  });
}

/** Minimal EIP-1193 surface used for signing. */
export interface SignProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

/** Asks the wallet to `personal_sign` `message` for `address`; rejects if the wallet returns no hex signature. */
export async function personalSign(provider: SignProvider, address: Address, message: string): Promise<`0x${string}`> {
  const sig = await provider.request({ method: "personal_sign", params: [stringToHex(message), address] });
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new Error("The wallet returned no signature.");
  return sig as `0x${string}`;
}
