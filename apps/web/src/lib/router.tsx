/**
 * A small history router: path patterns (`/f/:tokenId`) with named params, matched against a route table
 * (`app/routes.ts`). The shell has a dozen flat routes, so react-router's weight is not worth it on the landing budget.
 */
import { type AnchorHTMLAttributes, type MouseEvent, useSyncExternalStore } from "react";

/** A location split into path and query. */
export interface Loc {
  pathname: string;
  search: URLSearchParams;
}

/** Matches `pattern` ("/f/:tokenId") against `pathname`; returns decoded params or null. Trailing slashes ignored. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const norm = (p: string): string[] => (p.replace(/\/+$/, "") || "/").split("/").slice(1);
  const want = norm(pattern);
  const got = norm(pathname);
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    const w = want[i] ?? "";
    const g = got[i] ?? "";
    if (w.startsWith(":")) {
      if (!g) return null;
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null;
      }
    } else if (w !== g) return null;
  }
  return params;
}

/** Builds a path from a pattern and params ("/f/:tokenId", {tokenId:"7"} → "/f/7"). */
export function buildPath(pattern: string, params: Record<string, string> = {}): string {
  return pattern.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
}

const EVENT = "pl:navigate";

function subscribe(cb: () => void): () => void {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}
const snapshot = (): string => location.pathname + location.search;

/** Navigates within the shell (no reload). */
export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
  try {
    window.scrollTo(0, 0);
  } catch {
    // Non-browser environments (tests) have no scrolling.
  }
}

/** The current location; re-renders on navigation. */
export function useLocation(): Loc {
  const loc = useSyncExternalStore(subscribe, snapshot, () => "/");
  const q = loc.indexOf("?");
  return {
    pathname: q < 0 ? loc : loc.slice(0, q),
    search: new URLSearchParams(q < 0 ? "" : loc.slice(q)),
  };
}

/** An anchor that navigates in-app on plain left clicks and behaves normally otherwise (new tab, copy link). */
export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={click} {...rest} />;
}
