/**
 * Mountable first-visit intro: opens {@link IntroCards} once per browser, with the player's Friend when the shell
 * knows it, otherwise today's loaner. The stranger on card 3 is another baked loaner. Renders nothing once seen.
 */
import type { EconomyMode, FriendView } from "@pl/shared";
import { useEffect, useState } from "react";
import { type LoanerFriend, loadLoaners, loanerOfTheDay } from "../identity/loaners.js";
import { demoView } from "./demo.js";
import { IntroCards } from "./IntroCards.js";
import { shouldShowIntro } from "./progress.js";

/** Props of {@link FirstVisit}. */
export interface FirstVisitProps {
  /** "Play now": start a run (e.g. navigate to the play route). */
  onPlay: () => void;
  /** Called after skip or play, once the intro is closed. */
  onClose?: () => void;
  /** The player's Friend, if known. Falls back to today's loaner. */
  you?: FriendView | null;
  /** Show even if already seen (a "how it works" replay button). */
  force?: boolean;
  mode?: EconomyMode;
}

/** Picks a stranger: the loaner after `youId` in the roster (never the same Friend). */
export function pickStranger(loaners: readonly LoanerFriend[], youId: string): LoanerFriend | null {
  if (loaners.length === 0) return null;
  const at = loaners.findIndex((l) => l.appearance.tokenId === youId);
  for (let k = 1; k <= loaners.length; k++) {
    const l = loaners[(Math.max(at, 0) + k) % loaners.length];
    if (l && l.appearance.tokenId !== youId) return l;
  }
  return null;
}

/** The first-visit intro, shown once per browser (or whenever `force` is set). */
export function FirstVisit({ onPlay, onClose, you, force = false, mode }: FirstVisitProps) {
  const [open, setOpen] = useState(() => force || shouldShowIntro());
  const [cast, setCast] = useState<{ you: FriendView; stranger: FriendView } | null>(null);

  useEffect(() => {
    if (force) setOpen(true);
  }, [force]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadLoaners()
      .then((loaners) => {
        if (!live) return;
        const now = Date.now();
        const me = you ?? demoView(loanerOfTheDay(loaners, now).appearance, now);
        const other = pickStranger(loaners, me.appearance.tokenId);
        if (other) setCast({ you: me, stranger: demoView(other.appearance, now) });
      })
      .catch(() => {
        // No loaners (offline chunk failure): skip the intro rather than block the first run.
        if (live) setOpen(false);
      });
    return () => {
      live = false;
    };
  }, [open, you]);

  if (!open || !cast) return null;
  const close = (then?: () => void) => (): void => {
    setOpen(false);
    then?.();
    onClose?.();
  };
  return (
    <IntroCards
      open
      you={cast.you}
      stranger={cast.stranger}
      onPlay={close(onPlay)}
      onSkip={close()}
      {...(mode ? { mode } : {})}
    />
  );
}
