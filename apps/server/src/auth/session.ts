import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { getAddress, type Address } from "viem";
import type { AppContext } from "../context.js";
import { GUEST_COOKIE, SESSION_COOKIE, parseCookies, serializeCookie } from "../http/cookies.js";
import { HttpError } from "../http/errors.js";
import { signJwt, verifyJwt } from "../security/jwt.js";

/** An authenticated owner session (JWT verified and not revoked in the DB). */
export interface OwnerSession {
  readonly sid: string;
  readonly address: Address;
  readonly expiresAt: Date;
}

/** A guest identity from the signed `pl_guest` cookie. */
export interface GuestIdentity {
  readonly guestId: string;
  readonly expiresAt: Date;
}

const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

/** Creates a session row for `address` and returns the `Set-Cookie` value plus the session. */
export async function startSession(
  ctx: AppContext,
  address: Address,
): Promise<{ session: OwnerSession; setCookie: string }> {
  const now = ctx.now();
  const sid = randomUUID();
  const expiresAt = new Date(now.getTime() + ctx.config.sessionTtlSeconds * 1000);
  await ctx.repos.sessions.create({ sid, address, createdAt: now, expiresAt });
  const token = signJwt(
    { kind: "sess", sub: address.toLowerCase(), sid, iat: seconds(now), exp: seconds(expiresAt) },
    ctx.config.sessionSecret,
  );
  const setCookie = serializeCookie(SESSION_COOKIE, token, {
    maxAgeSeconds: ctx.config.sessionTtlSeconds,
    secure: ctx.config.cookieSecure,
  });
  return { session: { sid, address, expiresAt }, setCookie };
}

/** `Set-Cookie` value that clears the session cookie. */
export function clearSessionCookie(ctx: AppContext): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: ctx.config.cookieSecure });
}

/** Reads the owner session from request headers: valid signature, unexpired, and active (not revoked) in the DB. */
export async function readSession(ctx: AppContext, headers: IncomingHttpHeaders): Promise<OwnerSession | null> {
  const token = parseCookies(headers.cookie).get(SESSION_COOKIE);
  if (!token) return null;
  const now = ctx.now();
  const claims = verifyJwt(token, ctx.config.sessionSecret, "sess", seconds(now));
  if (!claims) return null;
  const row = await ctx.repos.sessions.findActive(claims.sid, now);
  if (!row || row.address !== claims.sub) return null;
  return { sid: row.sid, address: getAddress(row.address), expiresAt: row.expires_at };
}

/** Like {@link readSession} but throws 401 `no_session`. */
export async function requireSession(ctx: AppContext, headers: IncomingHttpHeaders): Promise<OwnerSession> {
  const session = await readSession(ctx, headers);
  if (!session) throw new HttpError(401, "unauthorized", "Sign in with your wallet first.", { reason: "no_session" });
  return session;
}

/** Reads the guest identity from the signed cookie (stateless: guests have no DB row). */
export function readGuest(ctx: AppContext, headers: IncomingHttpHeaders): GuestIdentity | null {
  const token = parseCookies(headers.cookie).get(GUEST_COOKIE);
  if (!token) return null;
  const claims = verifyJwt(token, ctx.config.sessionSecret, "guest", seconds(ctx.now()));
  if (!claims || !/^g_[A-Za-z0-9_-]{16,40}$/.test(claims.sub)) return null;
  return { guestId: claims.sub, expiresAt: new Date(claims.exp * 1000) };
}

/** Issues a new guest id and its `Set-Cookie` value (architecture §1.6 step 6: random id, 30 d). */
export function issueGuest(ctx: AppContext): { guest: GuestIdentity; setCookie: string } {
  const now = ctx.now();
  const guestId = `g_${randomBytes(16).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + ctx.config.guestTtlSeconds * 1000);
  const token = signJwt(
    { kind: "guest", sub: guestId, iat: seconds(now), exp: seconds(expiresAt) },
    ctx.config.sessionSecret,
  );
  const setCookie = serializeCookie(GUEST_COOKIE, token, {
    maxAgeSeconds: ctx.config.guestTtlSeconds,
    secure: ctx.config.cookieSecure,
  });
  return { guest: { guestId, expiresAt }, setCookie };
}
