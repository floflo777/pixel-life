import { ROBINHOOD_RPC_URL } from "./world.js";

/**
 * Redirects global `fetch` calls aimed at `from` (default: the public Robinhood RPC that the SDK
 * hardcodes, e.g. in `createFriendReader()`) to `to`. Node-side counterpart of Playwright's
 * `page.route`. Returns a restore function; always call it (e.g. in `afterEach`).
 */
export function redirectFetch(to: string, from: string = ROBINHOOD_RPC_URL): () => void {
  const original = globalThis.fetch;
  const prefix = from.replace(/\/$/, "");
  const redirected: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === prefix || url.startsWith(`${prefix}/`)) {
      const target = to.replace(/\/$/, "") + url.slice(prefix.length);
      return input instanceof Request ? original(new Request(target, input), init) : original(target, init);
    }
    return original(input, init);
  };
  globalThis.fetch = redirected;
  return () => {
    if (globalThis.fetch === redirected) globalThis.fetch = original;
  };
}
