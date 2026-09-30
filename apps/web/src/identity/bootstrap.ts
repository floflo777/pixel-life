/**
 * Starting points of an identity: instant guest play ("Play now": zero wallet calls, zero RPC) and the background
 * `/api/me` sync that restores an owner session from its cookie.
 */
import type { Services } from "../app/services.js";
import { loadGuestProfile } from "./guest.js";
import { loadLoaners, loanerOfTheDay, type LoanerFriend } from "./loaners.js";

let guestCookie: Promise<unknown> | null = null;

/** The loaner a guest plays: the one they picked before, else the loaner of the day. */
export function preferredLoaner(loaners: readonly LoanerFriend[], now = Date.now()): LoanerFriend {
  const stored = loadGuestProfile().loaner;
  return loaners.find((l) => l.appearance.tokenId === stored) ?? loanerOfTheDay(loaners, now);
}

/**
 * Ensures someone is playing: if nobody is, starts guest mode with the preferred loaner (or `tokenId`). Also asks the
 * server for a guest cookie in the background (presence and the Visitors board); failure never blocks play.
 */
export async function ensureGuest(s: Services, tokenId?: string): Promise<void> {
  const id = s.identity.store.get().identity;
  if (id.mode === "owner") return;
  if (id.mode === "guest" && (tokenId === undefined || id.loaner.appearance.tokenId === tokenId)) return;
  const loaners = await loadLoaners();
  const pick = (tokenId && loaners.find((l) => l.appearance.tokenId === tokenId)) || preferredLoaner(loaners);
  s.identity.startGuest(pick);
  guestCookie ??= s.api.guest().catch(() => {
    guestCookie = null;
  });
}

/** Restores an owner session from the server cookie (non-blocking; silent on failure). */
export async function syncMe(s: Services): Promise<void> {
  try {
    s.identity.syncMe(await s.api.me());
  } catch {
    // Offline or server down: keep the local identity; guests play on (GDD §6.10).
  }
}
