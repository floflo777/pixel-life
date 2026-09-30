/**
 * The route registry (GDD §6.1): the one table the shell routes from. Every screen is loaded lazily by path.
 *
 * Ownership: `shell` screens live next to the shell code (landing, hub, venues, identity, settings); `pages` screens
 * are the routed containers in `src/pages/routes/`, which wire the prop-driven page views to the API. Every screen
 * module default-exports a component taking {@link PageProps}.
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
  /** The module loader. */
  load: () => Promise<PageModule>;
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
  {
    name: "inbox",
    path: "/inbox",
    title: "Inbox",
    owner: "pages",
    load: () => import("../pages/routes/InboxRoute.js"),
    ownerOnly: true,
  },
  {
    name: "friend",
    path: "/f/:tokenId",
    title: "Friend",
    owner: "pages",
    load: () => import("../pages/routes/FriendRoute.js"),
  },
  {
    name: "home",
    path: "/home",
    title: "My isle",
    owner: "pages",
    load: () => import("../pages/routes/HomeRoute.js"),
    ownerOnly: true,
    nav: { label: "my isle", order: 2 },
  },
  {
    name: "isle",
    path: "/home/:tokenId",
    title: "Isle",
    owner: "pages",
    load: () => import("../pages/routes/HomeRoute.js"),
  },
  {
    name: "stamps",
    path: "/stamps",
    title: "Stamp book",
    owner: "pages",
    load: () => import("../pages/routes/StampsRoute.js"),
    ownerOnly: true,
    nav: { label: "stamps & belts", order: 3 },
  },
  {
    name: "stampsOf",
    path: "/stamps/:tokenId",
    title: "Stamp book",
    owner: "pages",
    load: () => import("../pages/routes/StampsRoute.js"),
  },
  {
    name: "shop",
    path: "/shop",
    title: "Greenhouse",
    owner: "pages",
    load: () => import("../pages/routes/GreenhouseRoute.js"),
    nav: { label: "greenhouse", order: 4 },
  },
  {
    name: "regrow",
    path: "/regrow",
    title: "Regrow",
    owner: "pages",
    load: () => import("../pages/routes/RegrowRoute.js"),
    ownerOnly: true,
  },
  {
    name: "mend",
    path: "/mend",
    title: "Mend board",
    owner: "pages",
    load: () => import("../pages/routes/MendBoardRoute.js"),
    nav: { label: "mend", order: 5 },
  },
  {
    name: "mendFriend",
    path: "/mend/:tokenId",
    title: "Mend",
    owner: "pages",
    load: () => import("../pages/routes/MendRoute.js"),
    ownerOnly: true,
  },
  {
    name: "board",
    path: "/board",
    title: "Daily board",
    owner: "pages",
    load: () => import("../pages/routes/DailyBoardRoute.js"),
    nav: { label: "daily", order: 6 },
  },
  {
    name: "market",
    path: "/market",
    title: "Gold market",
    owner: "pages",
    load: () => import("../pages/routes/MarketRoute.js"),
    nav: { label: "gold market", order: 7 },
  },
  {
    name: "economy",
    path: "/economy",
    title: "Economy & odds",
    owner: "pages",
    load: () => import("../pages/routes/EconomyRoute.js"),
    nav: { label: "economy", order: 8 },
  },
  {
    name: "about",
    path: "/about",
    title: "How to play",
    owner: "pages",
    load: () => import("../pages/routes/AboutRoute.js"),
    nav: { label: "about", order: 9 },
  },
];

/** The loader of a route. */
export function loaderOf(r: RouteDef): () => Promise<PageModule> {
  return r.load;
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
