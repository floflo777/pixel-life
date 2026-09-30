/**
 * The home screen's scar state: what `effectiveLost` says is still missing right now, which pixel heals next and how
 * far along it is. Pure (time passed in) so the "scars heal while you are away" behaviour is unit-tested.
 */
import {
  and,
  EMPTY_MASK,
  effectiveLost,
  frontMask,
  getBit,
  nextRegrowthAt,
  popcount,
  regrowthMsPerPx,
  regrowthOrder,
  wholeAt,
  type FriendView,
  type Hex64,
} from "@pl/shared";

/** Scars of a Friend as the home screen draws them at one instant. */
export interface HomeScars {
  front: Hex64;
  /** Effective lost mask at `now` (free regrowth applied). */
  lost: Hex64;
  lostCount: number;
  /** Pixel id that heals next (−1 when nothing heals). */
  sprout: number;
  /** Progress of `sprout` toward healing, 0..1. */
  growth: number;
  /** Ms until the next pixel heals / until whole; null when nothing heals. */
  nextInMs: number | null;
  wholeInMs: number | null;
}

/** Computes `HomeScars` for `friend` at `now` (ms), honouring its Gold Pixel regrowth perk. */
export function homeScars(friend: FriendView, now: number): HomeScars {
  const front = frontMask(friend.appearance);
  const tokenId = friend.appearance.tokenId;
  const opts = { goldHeld: friend.pub.goldHeld };
  const scars = friend.pub.scars;
  const lost = effectiveLost(scars, now, tokenId, opts);
  const next = nextRegrowthAt(scars, now, tokenId, opts);
  const whole = wholeAt(scars, now, tokenId, opts);
  let sprout = -1;
  if (lost !== EMPTY_MASK) {
    for (const id of regrowthOrder(tokenId)) {
      if (getBit(lost, id)) {
        sprout = id;
        break;
      }
    }
  }
  const per = regrowthMsPerPx(friend.pub.goldHeld);
  const growth = next === null ? 0 : Math.min(1, Math.max(0, 1 - (next - now) / per));
  return {
    front,
    lost: and(lost, front),
    lostCount: popcount(lost),
    sprout,
    growth,
    nextInMs: next === null ? null : Math.max(0, next - now),
    wholeInMs: whole === null ? null : Math.max(0, whole - now),
  };
}

/** Compact LCD duration: `12H`, `3H`, `45M`, `<1M`. Rounds up so a pending heal never reads as 0. */
export function shortDuration(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (min < 1) return "<1M";
  if (min < 60) return `${min}M`;
  return `${Math.ceil(min / 60)}H`;
}

/** Clock-style countdown `H:MM` (GDD "next px 12:04"); minutes rounded up. */
export function clockDuration(ms: number): string {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}
