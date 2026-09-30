/**
 * The route registry (GDD §6.1): the one table the shell routes from. Every screen is loaded lazily by path.
 *
 * Ownership: `shell` screens live next to the shell code (landing, hub, venues, identity, settings, inbox);
 * `pages` screens live in `src/pages/<Page>.tsx` (owned by the pages/UI task) and are discovered with
 * `import.meta.glob`: a page file that does not exist yet renders the "coming soon" placeholder instead of breaking the
 * build. Page modules default-export a component taking {@link PageProps}.
 */
import type { ComponentType } from "react";
import { buildPath, matchPath } from "../lib/router.js";

/** Props every routed screen receives. */
export interface PageProps {
  /** Named path params (`/f/:tokenId` → `{ tokenId }`). */
  params: Readonly<Record<string, string>>;
  search: URLSearchParams;
}

/** A lazily loaded screen module. */
export type PageModule = { default: ComponentType<PageProps> };

/** One routed screen. */
export interface RouteDef {
  /** Stable id, also used for `href`. */
  name: string;
  /** Path pattern with `:params`. */
  path: string;
  /** Document title (followed by "· Loose Pixels"). */
  title: string;
  owner: "shell" | "pages";
  /** `pages` routes: the file name in `src/pages` (without `.tsx`). */
  page?: string;
  /** `shell` routes: the module loader. */
  load?: () => Promise<PageModule>;
  /** Shown in the shell navigation. */
  nav?: { label: string; order: number };
  /** Informational: the screen is useful only with an owned Friend (pages gate themselves with a CTA). */
  ownerOnly?: boolean;
  /** Full-bleed screens (landing, play, hub) hide the page chrome padding. */
  bleed?: boolean;
}

/** Every route of the shell, most specific first. */
export const ROUTES: readonly RouteDef[] = [
  {
    name: "landing",
    path: "/",
    title: "Loose Pixels",
    owner: "shell",
    load: () => import("../shell/Landing.js"),
    bleed: true,
  },
  {
    name: "play",
    path: "/play",
    title: "Play",
    owner: "shell",
    load: () => import("../venues/PlayScreen.js"),
    bleed: true,
    nav: { label: "play", order: 0 },
  },
  {
    name: "sky",
    path: "/sky",
    title: "The Sky",
    owner: "shell",
    load: () => import("../hub/SkyScreen.js"),
    bleed: true,
    nav: { label: "sky", order: 1 },
  },
  {
    name: "venue",
    path: "/venue/:id",
    title: "Booth",
    owner: "shell",
    load: () => import("../venues/VenueScreen.js"),
  },
  {
    name: "connect",
    path: "/connect",
    title: "Use my Friend",
    owner: "shell",
    load: () => import("../identity/ConnectScreen.js"),
  },
  {
    name: "settings",
    path: "/settings",
    title: "Settings",
    owner: "shell",
    load: () => import("../settings/SettingsScreen.js"),
  },
  { name: "inbox", path: "/inbox", title: "Inbox", owner: "shell", load: () => import("../shell/InboxScreen.js") },
  { name: "friend", path: "/f/:tokenId", title: "Friend", owner: "pages", page: "FriendPage" },
  {
    name: "shop",
    path: "/shop",
    title: "Greenhouse",
    owner: "pages",
    page: "GreenhousePage",
    nav: { label: "greenhouse", order: 2 },
  },
  { name: "regrow", path: "/regrow", title: "Regrow", owner: "pages", page: "RegrowPage", ownerOnly: true },
  {
    name: "mend",
    path: "/mend",
    title: "Mend board",
    owner: "pages",
    page: "MendBoardPage",
    nav: { label: "mend", order: 3 },
  },
  {
    name: "board",
    path: "/board",
    title: "Daily board",
    owner: "pages",
    page: "DailyBoardPage",
    nav: { label: "daily", order: 4 },
  },
  { name: "market", path: "/market", title: "Market", owner: "pages", page: "MarketPage" },
  {
    name: "economy",
    path: "/economy",
    title: "Economy & odds",
    owner: "pages",
    page: "EconomyPage",
    nav: { label: "economy", order: 5 },
  },
  {
    name: "about",
    path: "/about",
    title: "How to play",
    owner: "pages",
    page: "AboutPage",
    nav: { label: "about", order: 6 },
  },
];

/** Page modules present in `src/pages` (resolved at build time). */
const PAGE_FILES = import.meta.glob<PageModule>("../pages/*.tsx");

/** The loader for a route, or null when its page file does not exist yet. */
export function loaderOf(r: RouteDef): (() => Promise<PageModule>) | null {
  if (r.load) return r.load;
  if (r.page) return PAGE_FILES[`../pages/${r.page}.tsx`] ?? null;
  return null;
}

/** A matched route. */
export interface RouteMatch {
  route: RouteDef;
  params: Record<string, string>;
}

/** Finds the route for `pathname`, or null (not found). */
export function resolveRoute(pathname: string, routes: readonly RouteDef[] = ROUTES): RouteMatch | null {
  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params) return { route, params };
  }
  return null;
}

/** Builds the URL of a named route (throws on an unknown name: a programming error). */
export function href(name: string, params: Record<string, string> = {}, query?: Record<string, string>): string {
  const r = ROUTES.find((x) => x.name === name);
  if (!r) throw new Error(`Unknown route ${name}`);
  const q = query ? `?${new URLSearchParams(query).toString()}` : "";
  return buildPath(r.path, params) + q;
}
