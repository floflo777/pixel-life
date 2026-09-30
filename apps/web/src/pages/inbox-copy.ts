/** User-facing sentences and grouping for inbox items (GDD §5.9 copy), including the market's sale notices. */
import type { AnyInboxItem } from "../api/client.js";
import { formatRf } from "../ui/format.js";

/** Inbox filter groups shown as tabs. */
export type InboxGroup = "mends" | "market" | "daily";

/** The group an item is filed under; unknown future kinds land in "daily" (general news). */
export function inboxGroup(item: AnyInboxItem): InboxGroup {
  switch (item.kind) {
    case "mended":
    case "whole":
      return "mends";
    case "market_sold":
    case "market_royalty":
      return "market";
    default:
      return "daily";
  }
}

/** True when the item carries an RF amount (it then shows the SIMULATED / LIVE label). */
export function inboxHasRf(item: AnyInboxItem): item is Extract<AnyInboxItem, { mode: unknown }> {
  return "mode" in item;
}

/** A one-glyph icon per kind (decorative; the sentence carries the meaning). */
export function inboxGlyph(item: AnyInboxItem): string {
  switch (item.kind) {
    case "mended":
      return "✚";
    case "whole":
      return "✓";
    case "badge":
      return "★";
    case "daily":
      return "▦";
    case "streak_risk":
      return "◌";
    case "market_sold":
      return "◆";
    case "market_royalty":
      return "◇";
    default:
      return "·";
  }
}

/** One sentence describing an inbox item. Unknown kinds (a newer server) get a neutral sentence instead of a crash. */
export function inboxCopy(item: AnyInboxItem): string {
  const sim = (mode: string): string => (mode === "sim" ? " simulated" : "");
  switch (item.kind) {
    case "mended": {
      const where = item.region ?? `${item.px} ${item.px === 1 ? "pixel" : "pixels"}`;
      const more = item.batched > 0 ? ` (+${item.batched} more menders today)` : "";
      return `#${item.by} mended #${item.tokenId}'s ${where} and paid it ${formatRf(item.toTargetMicro)}${sim(item.mode)}${more}.`;
    }
    case "whole":
      return `#${item.tokenId} is whole again.`;
    case "badge":
      return `top ${item.tier === "gold" ? "1" : "10"} % on ${item.day}. ${item.tier} banner on your island.`;
    case "daily":
      return `today's island is live (${item.day}).`;
    case "streak_risk":
      return `your ${item.streak}-day halo fades tomorrow.`;
    case "market_sold":
      return `#${item.buyer} bought your Gold Pixel (leaf ${item.leafId}) for ${formatRf(item.priceMicro)}${sim(item.mode)}: #${item.tokenId} got ${formatRf(item.toSellerMicro)}.`;
    case "market_royalty":
      return `a Gold Pixel #${item.tokenId} grew sold again (#${item.seller} → #${item.buyer}) for ${formatRf(item.priceMicro)}${sim(item.mode)}: ${formatRf(item.toOriginMicro)} royalty.`;
    default: {
      // Exhaustive for today's kinds; a kind added server-side later still renders.
      const unknown: never = item;
      void unknown;
      return "something new happened to your Friend.";
    }
  }
}
