/**
 * The Friend page (`/f/:tokenId`, GDD §6.6): the portrait with its live scars, N/N0 pixels, the free-heal timer, the
 * streak halo, gold held, stitches left by other Friends and, for the owner, the inbox. Public and shareable: visitors
 * get a Mend button, the owner gets Regrow. Data arrives as props (the shell loads it), so the page is pure UI.
 */
import {
  and,
  BPS,
  ECON,
  effectiveLost,
  type EconomyMode,
  familyName,
  frontMask,
  type FriendView,
  MAX_VISIBLE_GOLD,
  nextRegrowthAt,
  popcount,
  regrowthMsPerPx,
  STITCH_VISIBLE_MS,
  type TokenIdStr,
  wholeAt,
} from "@pl/shared";
import { type ReactNode, useMemo } from "react";
import type { AnyInboxItem } from "../api/client.js";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatAgo,
  formatClock,
  formatDuration,
  formatRf,
  FriendPortrait,
  nextStreakTier,
  PixelNumber,
  Pill,
  ProgressBlocks,
  type Remote,
  RemoteView,
  SimulatedBadge,
  Skeleton,
  streakTier,
  useNow,
} from "../ui/index.js";
import { inboxCopy } from "./inbox-copy.js";

/** A Friend that stitched this one recently. */
export interface Mender {
  by: TokenIdStr;
  px: number;
  at: number;
}

/** Who is looking at the page. `owner` = the bound wallet owns this Friend. */
export type Viewer = "owner" | "visitor" | "guest";

/** Props of {@link FriendPage}. */
export interface FriendPageProps {
  friend: Remote<FriendView>;
  onRetry?: () => void;
  viewer: Viewer;
  mode: EconomyMode;
  /** Owner's balance (micro-RF), shown next to Regrow. */
  balanceMicro?: number | null;
  /** Owner only. */
  inbox?: Remote<readonly AnyInboxItem[]>;
  onInboxRetry?: () => void;
  onInboxRead?: (ids: readonly string[] | "all") => void;
  /** Recent menders; derived from the inbox's `mended` items when absent. */
  menders?: readonly Mender[];
  onRegrow?: () => void;
  onMend?: () => void;
  onSeedPack?: () => void;
  onOpenFriend?: (tokenId: TokenIdStr) => void;
  onShare?: () => void;
  /** Extra cards after the page body (isle, stamps, belt). */
  footer?: ReactNode;
  /** Pinned clock for tests. */
  now?: number;
}

/** Menders from inbox `mended` items younger than the stitch lifetime, newest first. */
export function mendersFromInbox(items: readonly AnyInboxItem[], now: number): Mender[] {
  const out: Mender[] = [];
  for (const it of items) {
    if (it.kind === "mended" && now - it.createdAt < STITCH_VISIBLE_MS)
      out.push({ by: it.by, px: it.px, at: it.createdAt });
  }
  return out.sort((a, b) => b.at - a.at);
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function FriendSkeleton() {
  return (
    <div className="pl-grid-2" role="status" aria-live="polite">
      <span className="pl-sr-only">loading Friend…</span>
      <Skeleton width={192} height={192} />
      <div className="pl-stack">
        <Skeleton height={28} width="60%" />
        <Skeleton />
        <Skeleton width="80%" />
        <Skeleton width="70%" />
      </div>
    </div>
  );
}

/** The public Friend page. */
export function FriendPage(props: FriendPageProps) {
  return (
    <div className="pl-page">
      <RemoteView
        value={props.friend}
        {...(props.onRetry ? { onRetry: props.onRetry } : {})}
        loading={<FriendSkeleton />}
      >
        {(view) => <FriendBody {...props} view={view} />}
      </RemoteView>
      {props.footer}
    </div>
  );
}

function FriendBody({
  view,
  viewer,
  mode,
  balanceMicro,
  inbox,
  onInboxRetry,
  onInboxRead,
  menders,
  onRegrow,
  onMend,
  onSeedPack,
  onOpenFriend,
  onShare,
  now: fixedNow,
}: FriendPageProps & { view: FriendView }) {
  const now = useNow(1000, fixedNow);
  const tokenId = view.appearance.tokenId;
  const goldHeld = view.loaned ? 0 : view.pub.goldHeld;
  const front = useMemo(() => frontMask(view.appearance), [view.appearance]);
  const lost = and(effectiveLost(view.pub.scars, now, tokenId, { goldHeld }), front);
  const n0 = popcount(front);
  const n = n0 - popcount(lost);
  const missing = n0 - n;
  const next = nextRegrowthAt(view.pub.scars, now, tokenId, { goldHeld });
  const whole = wholeAt(view.pub.scars, now, tokenId, { goldHeld });
  const tier = streakTier(view.pub.streak);
  const upcoming = nextStreakTier(view.pub.streak);
  const pxPerDay = Math.floor((24 * 3600_000) / regrowthMsPerPx(goldHeld));
  const stitchedPx = view.pub.stitched ? popcount(and(view.pub.stitched, front)) : 0;
  const inboxItems = inbox?.status === "ready" ? inbox.data : [];
  const recentMenders = menders ?? mendersFromInbox(inboxItems, now);
  const family = familyName(view.appearance.familyId);
  const state = missing === 0 ? "whole" : missing <= Math.ceil(n0 * 0.1) ? "chipped" : "scarred";

  return (
    <>
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">
          #{tokenId} · {family}
        </h1>
        <div className="pl-row">
          {view.loaned && <Badge tone="ink">on loan</Badge>}
          {viewer === "owner" && <Badge tone="ink">yours</Badge>}
          <SimulatedBadge mode={mode} />
        </div>
      </header>

      <div className="pl-grid-2">
        <Card variant="hero" title="portrait" aria-label="portrait">
          <div className="pl-stack" style={{ justifyItems: "center" }}>
            <FriendPortrait view={view} lost={lost} scale={12} framed />
            <p className="pl-label" style={{ margin: 0 }}>
              ink = present · dotted = missing · gold = gold pixel · ringed = stitched
            </p>
          </div>
        </Card>

        <Card title={state} aria-label="state">
          <div className="pl-stack">
            <p style={{ margin: 0 }}>
              <PixelNumber value={n} size={34} /> <span className="pl-num">/ {n0} px</span>
            </p>
            <ProgressBlocks
              value={n}
              max={n0}
              blocks={Math.min(n0, 24)}
              label="pixels"
              valueText={`${n} of ${n0} pixels`}
              tone={missing > 0 ? "coral" : "ink"}
            />
            <dl className="pl-dl">
              <Stat label="heals free">
                {next !== null && whole !== null ? (
                  <span>
                    next pixel in <span className="pl-mono">{formatClock(next - now)}</span> · whole in{" "}
                    {formatDuration(whole - now)}
                  </span>
                ) : (
                  "nothing to heal"
                )}
              </Stat>
              <Stat label="rate">
                {pxPerDay} px/day
                {goldHeld > 0 && (
                  <span className="pl-sub">
                    {" "}
                    (gold ×
                    {(1 + (ECON.goldRegrowthBonusBps * Math.min(goldHeld, ECON.goldRegrowthMaxCount)) / BPS).toFixed(2)}
                    )
                  </span>
                )}
              </Stat>
              <Stat label="halo">
                <span className="pl-row" style={{ gap: 6 }}>
                  <span className="pl-swatch" style={{ background: tier.color }} aria-hidden="true" />
                  {tier.name} · {view.pub.streak}-day streak
                  {upcoming && (
                    <span className="pl-sub">
                      ({upcoming.from - view.pub.streak} to {upcoming.name})
                    </span>
                  )}
                </span>
              </Stat>
              <Stat label="gold">
                {goldHeld > 0 ? (
                  <span>
                    <Pill tone="gold">
                      {goldHeld} gold pixel{goldHeld === 1 ? "" : "s"}
                    </Pill>{" "}
                    <span className="pl-sub">{Math.min(goldHeld, MAX_VISIBLE_GOLD)} worn</span>
                  </span>
                ) : (
                  <span className="pl-sub">none held</span>
                )}
              </Stat>
              <Stat label="stitches">
                {stitchedPx > 0 ? (
                  `${stitchedPx} px stitched by other Friends`
                ) : (
                  <span className="pl-sub">none this week</span>
                )}
              </Stat>
            </dl>
            <Actions
              viewer={viewer}
              loaned={view.loaned}
              missing={missing}
              balanceMicro={balanceMicro ?? null}
              {...(onRegrow ? { onRegrow } : {})}
              {...(onMend ? { onMend } : {})}
              {...(onSeedPack ? { onSeedPack } : {})}
              {...(onShare ? { onShare } : {})}
            />
          </div>
        </Card>
      </div>

      <div className="pl-grid-2">
        <Card title="stitched by" aria-label="stitched by">
          {recentMenders.length === 0 ? (
            <EmptyState glyph="✚" title="no stitches yet">
              When another Friend mends this one, its stitches show here for 7 days.
            </EmptyState>
          ) : (
            <ul className="pl-list">
              {recentMenders.map((m) => (
                <li key={`${m.by}-${m.at}`} className="pl-row" style={{ justifyContent: "space-between" }}>
                  {onOpenFriend ? (
                    <Button variant="quiet" size="small" onClick={() => onOpenFriend(m.by)}>
                      #{m.by}
                    </Button>
                  ) : (
                    <span className="pl-num">#{m.by}</span>
                  )}
                  <span>
                    {m.px} px · <span className="pl-sub">{formatAgo(m.at, now)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {viewer === "owner" && inbox && (
          <Card
            title="inbox"
            aria-label="inbox"
            actions={
              onInboxRead && inboxItems.some((i) => i.readAt === null) ? (
                <Button size="small" variant="quiet" onClick={() => onInboxRead("all")}>
                  mark all read
                </Button>
              ) : undefined
            }
          >
            <RemoteView value={inbox} {...(onInboxRetry ? { onRetry: onInboxRetry } : {})}>
              {(items) =>
                items.length === 0 ? (
                  <EmptyState glyph="✉" title="nothing new" />
                ) : (
                  <ul className="pl-list">
                    {items.map((it) => (
                      <li
                        key={it.id}
                        className="pl-row"
                        style={{ justifyContent: "space-between", alignItems: "start" }}
                      >
                        <span style={{ flex: "1 1 200px" }}>
                          {it.readAt === null && (
                            <>
                              <Badge tone="ink">new</Badge>{" "}
                            </>
                          )}
                          {inboxCopy(it)}
                        </span>
                        <span className="pl-label">{formatAgo(it.createdAt, now)}</span>
                        {it.readAt === null && onInboxRead && (
                          <Button
                            size="small"
                            variant="quiet"
                            onClick={() => onInboxRead([it.id])}
                            aria-label={`mark read: ${inboxCopy(it)}`}
                          >
                            read
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              }
            </RemoteView>
          </Card>
        )}
      </div>
    </>
  );
}

function Actions({
  viewer,
  loaned,
  missing,
  balanceMicro,
  onRegrow,
  onMend,
  onSeedPack,
  onShare,
}: {
  viewer: Viewer;
  loaned: boolean;
  missing: number;
  balanceMicro: number | null;
  onRegrow?: () => void;
  onMend?: () => void;
  onSeedPack?: () => void;
  onShare?: () => void;
}) {
  if (viewer === "owner") {
    return (
      <div className="pl-stack">
        <div className="pl-row">
          {onRegrow && (
            <Button variant={missing > 0 ? "now" : "paper"} disabled={missing === 0} onClick={onRegrow}>
              regrow · {formatRf(ECON.regrowMicroPerPx)}/px
            </Button>
          )}
          {onSeedPack && <Button onClick={onSeedPack}>seed pack</Button>}
          {onShare && (
            <Button variant="quiet" onClick={onShare}>
              {missing > 0 ? "share · help me mend" : "share"}
            </Button>
          )}
        </div>
        {balanceMicro !== null && (
          <p className="pl-label" style={{ margin: 0 }}>
            balance {formatRf(balanceMicro)}
          </p>
        )}
      </div>
    );
  }
  if (loaned) {
    return (
      <p className="pl-sub">
        This Friend is on loan to a guest: its scars live on that device only, so it can't be mended.
      </p>
    );
  }
  return (
    <div className="pl-stack">
      <div className="pl-row">
        {onMend && (
          <Button
            variant={missing > 0 ? "now" : "paper"}
            disabled={missing === 0 || viewer === "guest"}
            onClick={onMend}
          >
            mend · {formatRf(ECON.mendMicroPerPx)}/px
          </Button>
        )}
        {onShare && (
          <Button variant="quiet" onClick={onShare}>
            share
          </Button>
        )}
      </div>
      {viewer === "guest" && missing > 0 && (
        <p className="pl-sub" style={{ margin: 0 }}>
          Bring your own Friend to mend others.
        </p>
      )}
      {missing > 0 && viewer !== "guest" && (
        <p className="pl-sub" style={{ margin: 0 }}>
          Half of every Mend goes straight into this Friend's wallet.
        </p>
      )}
    </div>
  );
}
