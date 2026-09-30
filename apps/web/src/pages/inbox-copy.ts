/** User-facing sentences for inbox items (GDD §5.9 copy). */
import { type InboxItem, assertNever } from "@pl/shared";
import { formatRf } from "../ui/format.js";

/** One lowercase sentence describing an inbox item. */
export function inboxCopy(item: InboxItem): string {
  switch (item.kind) {
    case "mended": {
      const where = item.region ?? `${item.px} ${item.px === 1 ? "pixel" : "pixels"}`;
      const more = item.batched > 0 ? ` (+${item.batched} more menders today)` : "";
      const sim = item.mode === "sim" ? " simulated" : "";
      return `#${item.by} mended #${item.tokenId}'s ${where} and paid it ${formatRf(item.toTargetMicro)}${sim}${more}.`;
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
      return `#${item.buyer} bought #${item.tokenId}'s gold pixel for ${formatRf(item.priceMicro)} (simulated).`;
    case "market_royalty":
      return `a gold pixel #${item.tokenId} grew sold again: ${formatRf(item.toOriginMicro)} royalty (simulated).`;
    default:
      return assertNever(item);
  }
}
