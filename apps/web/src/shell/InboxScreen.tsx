/**
 * `/inbox` (GDD §5.9): Mend notifications and friends, newest first; opening it marks everything read. Owners only
 * (guests have no inbox).
 */
import type { InboxItem } from "@pl/shared";
import { useEffect } from "react";
import { errorMessage } from "../api/client.js";
import type { PageProps } from "../app/routes.js";
import { useServices } from "../app/services.js";
import { formatRf } from "../lib/format.js";
import { Link } from "../lib/router.js";
import { useStore } from "../lib/store.js";
import { useAsync } from "../lib/use-async.js";
import { Card, ErrorBox, LinkButton, Loading, SimTag } from "../ui/kit.js";

/** One notification's copy (GDD §5.9 wording). */
export function inboxText(n: InboxItem): string {
  switch (n.kind) {
    case "mended": {
      const where = n.region ?? `${n.px} pixel${n.px === 1 ? "" : "s"}`;
      const more = n.batched > 0 ? ` (+${n.batched} more menders today)` : "";
      return `A stranger (#${n.by}) regrew #${n.tokenId}'s ${where} and paid its wallet ${formatRf(n.toTargetMicro)}${n.mode === "sim" ? " (simulated)" : ""}.${more}`;
    }
    case "whole":
      return `#${n.tokenId} is whole again.`;
    case "badge":
      return `Top ${n.tier === "gold" ? "1" : "10"} % on ${n.day}. A ${n.tier} banner on your island.`;
    case "daily":
      return `Today's island is live (${n.day}).`;
    case "streak_risk":
      return `Your ${n.streak}-day halo fades tomorrow.`;
    case "market_sold":
      return `#${n.buyer} bought #${n.tokenId}'s Gold Pixel for ${formatRf(n.priceMicro)} (simulated).`;
    case "market_royalty":
      return `A Gold Pixel #${n.tokenId} grew sold again: ${formatRf(n.toOriginMicro)} royalty (simulated).`;
  }
}

/** `/inbox` */
export default function InboxScreen(_props: PageProps) {
  const s = useServices();
  const { identity } = useStore(s.identity.store);
  const owner = identity.mode === "owner";
  const inbox = useAsync(() => (owner ? s.api.inbox() : Promise.resolve(null)), [owner]);

  useEffect(() => {
    if (inbox.status !== "ok" || !inbox.data || inbox.data.unread === 0) return;
    s.api.inboxRead({ all: true }).then(
      (r) => s.identity.updateOwner({ unread: r.unread }),
      () => undefined,
    );
  }, [inbox.status, inbox.data, s]);

  if (!owner)
    return (
      <div className="page">
        <Card title="inbox">
          <p>Your inbox fills when strangers mend your own Friend.</p>
          <LinkButton to="/connect">Use my Friend</LinkButton>
        </Card>
      </div>
    );
  return (
    <div className="page">
      <Card title="inbox">
        {inbox.status === "loading" && !inbox.data && <Loading label="reading your inbox" />}
        {inbox.status === "error" && <ErrorBox message={errorMessage(inbox.error)} onRetry={inbox.retry} />}
        {inbox.data && inbox.data.items.length === 0 && (
          <p>Nothing yet. When someone mends your Friend, it shows up here.</p>
        )}
        {inbox.data && inbox.data.items.length > 0 && (
          <ul className="inbox">
            {inbox.data.items.map((n) => (
              <li key={n.id} className={n.readAt === null ? "unread" : ""}>
                <p>
                  {inboxText(n)} {n.kind === "mended" && n.mode === "sim" && <SimTag />}
                </p>
                <p className="mono">
                  {new Date(n.createdAt).toLocaleString()} · <Link to={`/f/${n.tokenId}`}>#{n.tokenId}</Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
