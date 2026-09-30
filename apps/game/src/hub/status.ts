/**
 * Words and tints shown on hub Friends (pure): streak halo tier, the name-tag status line, room and venue names, the
 * Daily Stone countdown. Status = visible things, not numbers (GDD §12.2), so lines stay short and lowercase.
 */
import type { RoomSlug } from "@pl/shared";
import type { HaloTint } from "../post/tags";

/** Halo tint for a Daily streak (GDD §5.6: 0–2 paper, 3–6 sun, 7–13 coral, 14–29 lilac, 30+ gold-white). */
export function haloTint(streak: number): HaloTint {
  if (streak >= 30) return "goldWhite";
  if (streak >= 14) return "lilac";
  if (streak >= 7) return "coral";
  if (streak >= 3) return "sun";
  return "halo";
}

/** Display names of the hub rooms (door gates, the place card). */
export const ROOM_NAMES: Readonly<Record<RoomSlug, string>> = {
  plaza: "plaza",
  "pixel-arena": "the arena",
  "seed-booth": "greenhouse",
  "sky-docks": "sky docks",
  "daily-gate": "daily gate",
};

/** Short subtitle under a room's gate sign. */
export const ROOM_BLURB: Readonly<Record<RoomSlug, string>> = {
  plaza: "fountain · notice board",
  "pixel-arena": "fling games · statue",
  "seed-booth": "regrow · seeds",
  "sky-docks": "mend well",
  "daily-gate": "daily run · board",
};

/** Display names of venues (marquees, status lines). Unknown ids fall back to the id with dashes as spaces. */
export function venueName(id: string): string {
  // D-14: the flagship venue id stays `pixel-life` on the wire; players read "Loose Pixels".
  const known: Record<string, string> = {
    "pixel-life": "loose pixels",
    "seed-pack": "seed pack",
    handheld: "handheld arcade",
  };
  return known[id] ?? id.replace(/-/g, " ");
}

/** What the status line knows about a Friend. */
export interface StatusInput {
  readonly isYou: boolean;
  readonly resting: boolean;
  readonly loaned: boolean;
  readonly tokenId: string;
  /** Venue the Friend is playing right now. */
  readonly venue: string | null;
  readonly lostPx: number;
  /** ms until whole by free regrowth (null when whole or unknown). */
  readonly healsInMs: number | null;
  readonly gold: number;
  /** You stitched it this session. */
  readonly mendedByYou: boolean;
}

/** A compact duration: "3h", "45m", "2d". */
export function shortDuration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * The lowercase second line of a name tag, most important first: playing a venue, mended by you, healing, gold,
 * resting, on loan. Empty string when there is nothing worth saying.
 */
export function statusLine(s: StatusInput): string {
  const parts: string[] = [];
  if (s.venue) parts.push(`→ ${venueName(s.venue)}`);
  if (s.mendedByYou) parts.push("mended by you");
  else if (s.lostPx > 0) parts.push(s.healsInMs !== null ? `heals ${shortDuration(s.healsInMs)}` : `−${s.lostPx} px`);
  if (s.gold > 0 && parts.length < 2) parts.push(s.gold > 1 ? `gold ×${s.gold}` : "gold");
  if (s.resting && parts.length < 2) parts.push("resting");
  if (s.loaned && parts.length < 2) parts.push(`on loan`);
  return parts.slice(0, 2).join(" · ");
}

/** Time to the next Daily (UTC midnight) as `hh:mm:ss`. */
export function dailyCountdown(nowMs: number): string {
  const day = 86_400_000;
  const left = Math.max(0, day - (((nowMs % day) + day) % day));
  const s = Math.floor(left / 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
