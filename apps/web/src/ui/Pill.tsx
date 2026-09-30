import type { ReactNode } from "react";
import type { EconomyMode } from "@pl/shared";
import { cx } from "./cx.js";

/** Pill/badge colour. `now` (lime) is an urgent tag only: `4 loose · grab!`, `tap`, `● 6 playing · enter`. */
export type Tone = "paper" | "ink" | "now" | "coral" | "gold" | "sun" | "lilac" | "pond" | "meadow";

/** A small lowercase mono tag with a 2 px hard shadow. */
export function Pill({ tone = "paper", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={cx("pl-pill", tone !== "paper" && `pl-tone-${tone}`)} title={title}>
      {children}
    </span>
  );
}

/** A flat uppercase Silkscreen badge (status words: VERIFIED, OWNER, ON LOAN). */
export function Badge({ tone = "paper", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={cx("pl-badge", tone !== "paper" && `pl-tone-${tone}`)} title={title}>
      {children}
    </span>
  );
}

/**
 * The mandatory label next to every RF figure (CONTRIBUTING, D-12): SIMULATED in sim mode, LIVE otherwise. It is an
 * ink ribbon, never lime, and carries a plain-language explanation for screen readers and hover.
 */
export function SimulatedBadge({ mode = "sim" }: { mode?: EconomyMode }) {
  if (mode === "live") {
    return (
      <span className="pl-badge pl-badge--live" title="Real RF on Robinhood Chain: your wallet confirms each payment.">
        LIVE RF
      </span>
    );
  }
  return (
    <span className="pl-badge pl-badge--sim" title="Simulated RF: no transaction is sent and no real tokens move.">
      SIMULATED
      <span className="pl-sr-only"> RF: no real tokens move</span>
    </span>
  );
}
