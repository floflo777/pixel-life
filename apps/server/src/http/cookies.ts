/** Cookie names (architecture §1.6). */
export const SESSION_COOKIE = "pl_sess";
export const GUEST_COOKIE = "pl_guest";

/** Parses a `Cookie` header into a map (first occurrence wins, values URI-decoded when valid). */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || out.has(name)) continue;
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      out.set(name, decodeURIComponent(value));
    } catch {
      out.set(name, value);
    }
  }
  return out;
}

/** Options for {@link serializeCookie}. Cookies are always HttpOnly, Path=/ and SameSite=Lax. */
export interface CookieOptions {
  readonly maxAgeSeconds: number;
  readonly secure: boolean;
}

/** Builds a `Set-Cookie` value. `maxAgeSeconds: 0` clears the cookie. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.maxAgeSeconds <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
