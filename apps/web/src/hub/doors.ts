/**
 * Where every hub door leads (pure). The scene reports `onEnterVenue({ venueId, mode, room })` for venue doormats
 * (games) and for the page doors (Greenhouse, Daily Stone, Mend board); this module turns that into a card to show
 * or a route to open, and remembers the room to come back to.
 */
import { ROOMS, type RoomSlug, type TokenIdStr } from "@pl/shared";
import { NATIVE_VENUES, SDK_VENUES, type VenueMode } from "../venues/registry.js";

/** Door targets that open a shell page rather than a venue. */
export const PAGE_DOORS: Readonly<Record<string, { readonly title: string; readonly href: string }>> = {
  greenhouse: { title: "Greenhouse", href: "/regrow" },
  "daily-stone": { title: "Daily Stone", href: "/board" },
  "mend-board": { title: "Mend board", href: "/mend" },
};

/** What walking into a door does. */
export type DoorAction =
  /** Show the venue card (GDD §11.5), then open `href`. */
  | {
      readonly kind: "venue";
      readonly venueId: string;
      readonly name: string;
      readonly rule: string;
      readonly mode: VenueMode;
      readonly href: string;
    }
  /** Open a page straight away. */
  | { readonly kind: "page"; readonly title: string; readonly href: string }
  /** A door the shell does not know (a newer scene than this shell): stay in the hub. */
  | { readonly kind: "none" };

/** The route that plays a native venue (`/play?venue=&mode=`); the flagship quick run is plain `/play`. */
export function playHref(venueId: string, mode: VenueMode): string {
  const q = new URLSearchParams();
  if (venueId !== "pixel-life") q.set("venue", venueId);
  if (mode === "daily") q.set("mode", "daily");
  const s = q.toString();
  return s ? `/play?${s}` : "/play";
}

/** Maps a door entry to its action. */
export function doorAction(venueId: string, mode: string | null): DoorAction {
  const page = PAGE_DOORS[venueId];
  if (page) return { kind: "page", title: page.title, href: page.href };
  const runMode: VenueMode = mode === "daily" ? "daily" : "quick";
  const native = NATIVE_VENUES[venueId];
  if (native)
    return {
      kind: "venue",
      venueId,
      name: runMode === "daily" ? `${native.manifest.name} · Daily` : native.manifest.name,
      rule: native.rule,
      mode: runMode,
      href: playHref(venueId, runMode),
    };
  const sdk = SDK_VENUES[venueId];
  if (sdk)
    return {
      kind: "venue",
      venueId,
      name: sdk.manifest.name,
      rule: sdk.rule,
      mode: "quick",
      href: `/venue/${venueId}`,
    };
  return { kind: "none" };
}

/** The Mend flow for a scarred Friend (the Friend page opens its Mend panel on `?action=mend`). */
export function mendHref(tokenId: TokenIdStr): string {
  return `/f/${encodeURIComponent(tokenId)}?action=mend`;
}

/** A Friend's public page. */
export function friendHref(tokenId: TokenIdStr): string {
  return `/f/${encodeURIComponent(tokenId)}`;
}

/** A Friend's home island, visited from the hub (`/sky?home=`). */
export function homeHref(tokenId: TokenIdStr): string {
  return `/sky?home=${encodeURIComponent(tokenId)}`;
}

const ROOM_KEY = "pl.sky.room";

/** The room to come back to after a venue or page (per tab), default the plaza. */
export function lastRoom(storage: Pick<Storage, "getItem"> | null = safeSession()): RoomSlug {
  try {
    const r = storage?.getItem(ROOM_KEY);
    return ROOMS.find((x) => x === r) ?? "plaza";
  } catch {
    return "plaza";
  }
}

/** Remembers the current room for {@link lastRoom}. */
export function rememberRoom(room: RoomSlug, storage: Pick<Storage, "setItem"> | null = safeSession()): void {
  try {
    storage?.setItem(ROOM_KEY, room);
  } catch {
    // Private mode / blocked storage: coming back to the plaza is fine.
  }
}

function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
