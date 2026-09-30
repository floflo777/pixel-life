import { createHmac, timingSafeEqual } from "node:crypto";

/** Claims we put in every token. `kind` separates session and guest tokens so one can never pass as the other. */
export interface BaseClaims {
  readonly sub: string;
  readonly iat: number;
  readonly exp: number;
  readonly kind: "sess" | "guest";
}

/** Owner session claims (architecture §1.6): address + server-side session id for revocation. */
export interface SessionClaims extends BaseClaims {
  readonly kind: "sess";
  readonly sid: string;
}

/** Guest claims: a random id used only for presence and the Visitors board. */
export interface GuestClaims extends BaseClaims {
  readonly kind: "guest";
}

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const AUDIENCE = "pixel-life";

const sign = (input: string, secret: string) => createHmac("sha256", secret).update(input).digest();

/** Signs `claims` as a compact HS256 JWT with `aud: pixel-life`. */
export function signJwt(claims: SessionClaims | GuestClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, aud: AUDIENCE })).toString("base64url");
  const signingInput = `${HEADER}.${payload}`;
  return `${signingInput}.${sign(signingInput, secret).toString("base64url")}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Verifies an HS256 JWT of the expected `kind`: exact header, constant-time MAC, audience, iat/exp window.
 * Returns null on any failure; callers never learn why (no oracle).
 */
export function verifyJwt(token: string, secret: string, kind: "sess", nowSec: number): SessionClaims | null;
export function verifyJwt(token: string, secret: string, kind: "guest", nowSec: number): GuestClaims | null;
export function verifyJwt(
  token: string,
  secret: string,
  kind: "sess" | "guest",
  nowSec: number,
): SessionClaims | GuestClaims | null {
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, mac] = parts as [string, string, string];
  // Only our exact header is accepted: rules out alg=none and algorithm confusion.
  if (header !== HEADER) return null;
  const expected = sign(`${header}.${payload}`, secret);
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(claims)) return null;
  const { sub, iat, exp, aud } = claims;
  if (claims["kind"] !== kind || aud !== AUDIENCE) return null;
  if (typeof sub !== "string" || typeof iat !== "number" || typeof exp !== "number") return null;
  if (iat > nowSec + 60 || exp <= nowSec) return null;
  if (kind === "sess") {
    const sid = claims["sid"];
    if (typeof sid !== "string") return null;
    return { sub, iat, exp, kind, sid };
  }
  return { sub, iat, exp, kind };
}
