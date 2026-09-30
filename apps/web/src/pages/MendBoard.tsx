/**
 * The Mend board (the Mend Well, GDD §6.5/§11.6): scarred Friends in the Sky that anyone with their own Friend can help.
 * Sorted by most missing first; your own Friend and Friends whose scars healed meanwhile are left out.
 */
import {
  and,
  ECON,
  effectiveLost,
  type EconomyMode,
  type FamilyId,
  familyName,
  type FriendAppearance,
  type FriendPublic,
  frontMask,
  popcount,
  type TokenIdStr,
  wholeAt,
} from "@pl/shared";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatDuration,
  formatRf,
  FriendPortrait,
  type Remote,
  RemoteView,
  SimulatedBadge,
  Skeleton,
  useNow,
} from "../ui/index.js";

/** A Friend on the board: `SkyFriend` from `GET /api/sky`, plus its appearance when already loaded. */
export interface MendCandidate {
  tokenId: TokenIdStr;
  familyId: FamilyId;
  pub: FriendPublic;
  appearance?: FriendAppearance;
}

/** Props of {@link MendBoard}. */
export interface MendBoardProps {
  friends: Remote<readonly MendCandidate[]>;
  onRetry?: () => void;
  mode: EconomyMode;
  /** The viewer's own Friend (hidden from the board), or null for guests. */
  viewerTokenId: TokenIdStr | null;
  onMend?: (tokenId: TokenIdStr) => void;
  onOpen?: (tokenId: TokenIdStr) => void;
  now?: number;
}

/** A board row with its live missing count. */
export interface MendRow {
  c: MendCandidate;
  missing: number;
  n0: number | null;
  wholeAt: number | null;
}

/** Live rows: effective scars at `now`, scarred only, viewer excluded, most missing first then by token id. */
export function mendRows(list: readonly MendCandidate[], now: number, viewer: TokenIdStr | null): MendRow[] {
  const rows: MendRow[] = [];
  for (const c of list) {
    if (c.tokenId === viewer) continue;
    const lost = effectiveLost(c.pub.scars, now, c.tokenId, { goldHeld: c.pub.goldHeld });
    const front = c.appearance ? frontMask(c.appearance) : null;
    const missing = popcount(front ? and(lost, front) : lost);
    if (missing === 0) continue;
    rows.push({
      c,
      missing,
      n0: front ? popcount(front) : null,
      wholeAt: wholeAt(c.pub.scars, now, c.tokenId, { goldHeld: c.pub.goldHeld }),
    });
  }
  return rows.sort((a, b) => b.missing - a.missing || a.c.tokenId.localeCompare(b.c.tokenId));
}

/** The list of scarred Friends to help. */
export function MendBoard({ friends, onRetry, mode, viewerTokenId, onMend, onOpen, now: fixedNow }: MendBoardProps) {
  const now = useNow(10_000, fixedNow);
  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">mend well</h1>
        <SimulatedBadge mode={mode} />
      </header>
      <p style={{ margin: 0 }}>
        These Friends lost pixels in their runs. Mend fills them now for {formatRf(ECON.mendMicroPerPx)}/px:{" "}
        <strong>half is burned, half goes into that Friend's own wallet</strong>, and your stitches show on it for 7
        days.
      </p>
      {viewerTokenId === null && (
        <p className="pl-sub" style={{ margin: 0 }}>
          Guests can look, but mending needs your own Friend.
        </p>
      )}
      <RemoteView
        value={friends}
        {...(onRetry ? { onRetry } : {})}
        loading={
          <ul className="pl-cards" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton height={180} />
              </li>
            ))}
          </ul>
        }
      >
        {(list) => {
          const rows = mendRows(list, now, viewerTokenId);
          if (rows.length === 0) {
            return (
              <EmptyState glyph="✓" title="everyone is whole">
                No Friend here needs mending right now. Scars heal for free over time, too.
              </EmptyState>
            );
          }
          return (
            <ul className="pl-cards" aria-label={`${rows.length} Friends to mend`}>
              {rows.map(({ c, missing, n0, wholeAt: w }) => (
                <Card
                  key={c.tokenId}
                  as="li"
                  level={3}
                  title={`#${c.tokenId}`}
                  actions={<Badge>{familyName(c.familyId)}</Badge>}
                >
                  <div className="pl-stack">
                    {c.appearance ? (
                      <FriendPortrait view={{ appearance: c.appearance, pub: c.pub, loaned: false }} scale={6} framed />
                    ) : (
                      <Skeleton width={96} height={96} />
                    )}
                    <p style={{ margin: 0 }}>
                      <span className="pl-num">{missing} px</span> missing
                      {n0 !== null && <span className="pl-sub"> of {n0}</span>}
                    </p>
                    {w !== null && (
                      <p className="pl-label" style={{ margin: 0 }}>
                        heals free in {formatDuration(w - now)}
                      </p>
                    )}
                    <div className="pl-row">
                      {onMend && (
                        <Button
                          size="small"
                          disabled={viewerTokenId === null}
                          onClick={() => onMend(c.tokenId)}
                          aria-label={`mend #${c.tokenId}`}
                        >
                          mend · {formatRf(ECON.mendMicroPerPx)}/px
                        </Button>
                      )}
                      {onOpen && (
                        <Button
                          size="small"
                          variant="quiet"
                          onClick={() => onOpen(c.tokenId)}
                          aria-label={`open #${c.tokenId}`}
                        >
                          page
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </ul>
          );
        }}
      </RemoteView>
    </div>
  );
}
