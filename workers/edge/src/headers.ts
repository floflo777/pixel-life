/**
 * Security headers for everything the edge serves. The SDK child CSP is byte-identical to FriendSDK 0.1.4
 * (`scripts/dev-game.mjs` childCsp) plus `frame-ancestors 'self'`, which a meta tag cannot express.
 */

/** FriendSDK 0.1.4 child document CSP (architecture §1.1). Keep in sync when the SDK is upgraded. */
export const SDK_CHILD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
  "font-src 'self'; media-src 'self' blob:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com; " +
  "base-uri 'none'; form-action 'none'; frame-src 'none'";

/** Child documents may only be framed by our own shell. */
export const CHILD_CSP = `${SDK_CHILD_CSP}; frame-ancestors 'self'`;

/**
 * Default CSP for the shell (landing, hub, venues). Same-origin API and WebSocket (`'self'` covers wss: in CSP3),
 * the public Robinhood RPC for SDK reads, blob workers/media for three.js and audio. Override with the SHELL_CSP var.
 */
export const DEFAULT_SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://rpc.mainnet.chain.robinhood.com",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Headers on every response, static or proxied. */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  // Wallet popups (e.g. Coinbase) need window.opener, so not plain same-origin.
  "cross-origin-opener-policy": "same-origin-allow-popups",
};

/** `/venues/<id>/game.html`: an SDK child document mounted in the sandboxed iframe. */
const CHILD_DOCUMENT = /^\/venues\/[a-z0-9-]+\/game\.html$/;
/** Vite's content-hashed build output. */
const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** Whether `pathname` is an SDK child document. */
export const isChildDocument = (pathname: string): boolean => CHILD_DOCUMENT.test(pathname);

/**
 * Returns `response` with the static-asset security and cache headers for `pathname` applied.
 * `shellCsp` null means "leave the shell without a CSP header" (SHELL_CSP set to an empty string).
 */
export function withStaticHeaders(pathname: string, response: Response, shellCsp: string | null): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASE_HEADERS)) out.headers.set(name, value);
  const html = (out.headers.get("content-type") ?? "").includes("text/html");
  if (isChildDocument(pathname)) {
    out.headers.set("content-security-policy", CHILD_CSP);
    out.headers.set("x-frame-options", "SAMEORIGIN");
  } else if (html) {
    if (shellCsp) out.headers.set("content-security-policy", shellCsp);
    out.headers.set("x-frame-options", "DENY");
  }
  if (html) out.headers.set("cache-control", "no-cache");
  else if (HASHED_ASSET.test(pathname) && out.status === 200) {
    out.headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  return out;
}
