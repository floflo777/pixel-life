import { randomBytes } from "node:crypto";
import type { VerifyReq } from "@pl/shared";
import { getAddress, isAddress, type Address } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { siweDomains } from "../config.js";
import type { AppContext } from "../context.js";
import { HttpError, type ErrorReason } from "../http/errors.js";

/** Clock skew tolerated between the wallet and the server. */
const SKEW_MS = 60_000;

/** Creates and stores a single-use nonce (architecture §1.6 step 1). 32 hex chars: EIP-4361 alphanumeric. */
export async function issueNonce(ctx: AppContext): Promise<{ nonce: string; expiresAt: Date }> {
  const now = ctx.now();
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + ctx.config.nonceTtlSeconds * 1000);
  await ctx.repos.nonces.create(nonce, now, expiresAt);
  return { nonce, expiresAt };
}

const invalid = (message: string) => new HttpError(400, "bad_request", message, { reason: "invalid_message" });
const denied = (reason: ErrorReason, message: string) => new HttpError(401, "unauthorized", message, { reason });

/**
 * Verifies a SIWE sign-in (architecture §1.6 step 3) and returns the signer address.
 * Order: parse → domain/uri → chain → time window → signature (viem verifyMessage: EOA, EIP-1271, ERC-6492)
 * → atomically consume the nonce. The nonce is consumed last so a bad request cannot burn a victim's
 * nonce, and consumption is a single conditional UPDATE so a replay can never win twice.
 */
export async function verifySiwe(ctx: AppContext, { message: rawMessage, signature }: VerifyReq): Promise<Address> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(rawMessage);
  } catch {
    throw invalid("message is not a valid EIP-4361 message.");
  }
  const { address, domain, uri, chainId, nonce, version, issuedAt, expirationTime, notBefore } = parsed;
  if (!address || !isAddress(address, { strict: false })) throw invalid("message has no valid address.");
  if (!domain || !uri || !nonce || version !== "1" || chainId === undefined || !issuedAt) {
    throw invalid("message is missing required EIP-4361 fields.");
  }

  if (!siweDomains(ctx.config).includes(domain)) throw denied("wrong_domain", "Message is for another site.");
  let uriOrigin: string | null;
  try {
    uriOrigin = new URL(uri).origin;
  } catch {
    uriOrigin = null;
  }
  if (!uriOrigin || !ctx.config.publicOrigins.includes(uriOrigin) || new URL(uriOrigin).host !== domain) {
    throw denied("wrong_domain", "Message URI does not match this site.");
  }
  if (chainId !== ctx.config.chainId) {
    throw denied("wrong_chain", `Sign in on chain ${ctx.config.chainId}.`);
  }

  const now = ctx.now().getTime();
  const times = [issuedAt, expirationTime, notBefore].filter((t): t is Date => t !== undefined);
  if (times.some((t) => Number.isNaN(t.getTime()))) throw invalid("message has an invalid timestamp.");
  if (!expirationTime) throw invalid("message must carry an expiration time.");
  if (issuedAt.getTime() > now + SKEW_MS) throw denied("expired", "Message is issued in the future.");
  if (issuedAt.getTime() < now - ctx.config.nonceTtlSeconds * 1000 - SKEW_MS) {
    throw denied("expired", "Message is too old. Sign in again.");
  }
  if (expirationTime.getTime() <= now) throw denied("expired", "Message has expired. Sign in again.");
  if (notBefore && notBefore.getTime() > now + SKEW_MS) throw denied("expired", "Message is not valid yet.");

  const signer = getAddress(address);
  let valid: boolean;
  try {
    valid = await ctx.chain.verifyMessage({ address: signer, message: rawMessage, signature });
  } catch {
    throw new HttpError(503, "internal", "Could not verify the signature right now. Try again.", {
      reason: "rpc_error",
    });
  }
  if (!valid) throw denied("bad_signature", "Signature does not match the address.");

  if (!(await ctx.repos.nonces.consume(nonce, ctx.now()))) {
    throw denied("invalid_nonce", "Nonce is unknown, expired or already used. Sign in again.");
  }
  return signer;
}
