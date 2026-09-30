/**
 * `/inbox` (GDD §5.9): every notification kind, newest first, filterable by group (mends, market, daily news). Opening
 * it marks everything read on the server; the items that were new keep their "new" tag for this visit.
 */
import { useEffect, useRef, useState } from "react";
import { type AnyInboxItem, errorMessage } from "../../api/client.js";
import { type PageProps, useIdentity, useRemote, useServices } from "../../app/hooks.js";
import { Link } from "../../lib/router.js";
import { Badge, Card, EmptyState, formatAgo, RemoteView, SimulatedBadge, Tabs, useNow } from "../../ui/index.js";
import { inboxCopy, inboxGlyph, inboxGroup, type InboxGroup, inboxHasRf } from "../inbox-copy.js";
import { OwnerGate } from "./common.js";

type Filter = "all" | InboxGroup;

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "mends", label: "mends" },
  { id: "market", label: "market" },
  { id: "daily", label: "news" },
];

/** One notification row. */
export function InboxRow({ item, now, isNew }: { item: AnyInboxItem; now: number; isNew: boolean }) {
  return (
    <li className="pl-row" style={{ alignItems: "start", justifyContent: "space-between" }}>
      <span aria-hidden="true" className="pl-num" style={{ width: 20 }}>
        {inboxGlyph(item)}
      </span>
      <span style={{ flex: "1 1 220px" }}>
        {isNew && (
          <>
            <Badge tone="ink">new</Badge>{" "}
          </>
        )}
        {inboxCopy(item)} {inboxHasRf(item) && <SimulatedBadge mode={item.mode} />}
      </span>
      <span className="pl-label">
        {formatAgo(item.createdAt, now)} · <Link to={`/f/${item.tokenId}`}>#{item.tokenId}</Link>
      </span>
    </li>
  );
}

/** `/inbox` */
export default function InboxRoute(_props: PageProps) {
  const s = useServices();
  const id = useIdentity();
  const owner = id.mode === "owner";
  const inbox = useRemote(async () => (owner ? s.api.inbox() : null), [owner]);
  const [filter, setFilter] = useState<Filter>("all");
  const now = useNow(30_000);
  const marked = useRef(false);

  const data = inbox.value.status === "ready" ? inbox.value.data : null;
  useEffect(() => {
    if (!data || data.unread === 0 || marked.current) return;
    marked.current = true;
    s.api.inboxRead({ all: true }).then(
      (r) => s.identity.updateOwner({ unread: r.unread }),
      (e: unknown) => s.toast(errorMessage(e), "bad"),
    );
  }, [data, s]);

  if (!owner) {
    return <OwnerGate title="inbox">Your inbox fills when strangers mend your own Friend or buy its Gold.</OwnerGate>;
  }
  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">inbox</h1>
      </header>
      <Card>
        <Tabs label="filter notifications" tabs={FILTERS} value={filter} onChange={setFilter}>
          <RemoteView value={inbox.value} onRetry={inbox.retry}>
            {(res) => {
              const items = (res?.items ?? []).filter((i) => filter === "all" || inboxGroup(i) === filter);
              if (items.length === 0) {
                return (
                  <EmptyState glyph="✉" title="nothing here yet">
                    When someone mends your Friend or buys its Gold, it shows up here.
                  </EmptyState>
                );
              }
              return (
                <ul className="pl-list" aria-label={`${items.length} notifications`}>
                  {items.map((it) => (
                    <InboxRow key={it.id} item={it} now={now} isNew={it.readAt === null} />
                  ))}
                </ul>
              );
            }}
          </RemoteView>
        </Tabs>
      </Card>
    </div>
  );
}
