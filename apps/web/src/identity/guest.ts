/**
 * Guest state (D-11): which loaner the guest plays and the loaners' scars, kept in localStorage only. A loaned Friend
 * belongs to someone else, so a guest never writes shared state; free regrowth runs on the local copy with the same
 * shared functions the server uses.
 */
import {
  applyLoss,
  frontMask,
  type FriendView,
  type Hex64,
  isHex64,
  type ScarState,
  settleScars,
  wholeScars,
} from "@pl/shared";
import { isRecord, readJson, writeJson } from "../lib/storage.js";
import type { LoanerFriend } from "./loaners.js";

const KEY = "pl.guest.v1";

/** What a guest keeps in this browser. */
export interface GuestProfile {
  v: 1;
  /** Token id of the loaner the guest last picked (null = loaner of the day). */
  loaner: string | null;
  /** Scars per loaner token id (local copies only). */
  scars: Record<string, ScarState>;
}

const EMPTY: GuestProfile = { v: 1, loaner: null, scars: {} };

function isScarState(v: unknown): v is ScarState {
  return (
    isRecord(v) &&
    isHex64(v.lost) &&
    Number.isSafeInteger(v.updatedAt) &&
    Number.isSafeInteger(v.version) &&
    (v.updatedAt as number) >= 0
  );
}

function isProfile(v: unknown): v is GuestProfile {
  if (!isRecord(v) || v.v !== 1 || !isRecord(v.scars)) return false;
  if (v.loaner !== null && typeof v.loaner !== "string") return false;
  return Object.values(v.scars).every(isScarState);
}

/** Reads the guest profile (defaults when missing or corrupt). */
export function loadGuestProfile(): GuestProfile {
  return readJson(KEY, EMPTY, isProfile);
}

/** Persists the guest profile; returns false if storage is unavailable (the session still works in memory). */
export function saveGuestProfile(p: GuestProfile): boolean {
  return writeJson(KEY, p);
}

/** The loaner's local scars as of `now` (regrowth applied), or whole if it never ran. */
export function guestScars(p: GuestProfile, tokenId: string, now: number): ScarState {
  const s = p.scars[tokenId];
  return s ? settleScars(s, now, tokenId) : wholeScars(now);
}

/** The `FriendView` a guest plays with: the loaner's appearance, its local scars, no economy, `loaned: true`. */
export function guestFriendView(loaner: LoanerFriend, p: GuestProfile, now: number): FriendView {
  const { tokenId } = loaner.appearance;
  return {
    appearance: loaner.appearance,
    loaned: true,
    pub: {
      tokenId,
      scars: guestScars(p, tokenId, now),
      goldHeld: 0,
      glowCracks: 0,
      streak: 0,
      lastSeen: now,
      economy: "sim",
    },
  };
}

/** Applies a finished run's `lostDelta` to the loaner's local copy (clipped to its front mask and the 50 % floor). */
export function applyGuestRun(p: GuestProfile, loaner: LoanerFriend, lostDelta: Hex64, now: number): GuestProfile {
  const { tokenId } = loaner.appearance;
  const prev = p.scars[tokenId] ?? wholeScars(now);
  const next = applyLoss(prev, lostDelta, now, tokenId, { front: frontMask(loaner.appearance) });
  return { ...p, scars: { ...p.scars, [tokenId]: next } };
}
