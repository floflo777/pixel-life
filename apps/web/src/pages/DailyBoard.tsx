/**
 * The Daily board (GDD §5.5): today's seed, the countdown to the next island and the two boards, owners (verified
 * replays, one ranked attempt per Friend) and visitors (guests, unverified, top 100). Rewards are status only.
 */
import type { BoardEntry, BoardKind, DailyBoardRes, DailySeed, TokenIdStr } from "@pl/shared";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  formatClock,
  formatInt,
  type Remote,
  RemoteView,
  Tabs,
  useNow,
} from "../ui/index.js";

/** Props of {@link DailyBoard}. */
export interface DailyBoardProps {
  /** Today's seed (for the countdown), when known. */
  seed: DailySeed | null;
  board: BoardKind;
  onBoardChange: (b: BoardKind) => void;
  data: Remote<DailyBoardRes>;
  onRetry?: () => void;
  onPlay?: () => void;
  onOpenFriend?: (tokenId: TokenIdStr) => void;
  now?: number;
}

const BOARDS = [
  { id: "owners", label: "owners" },
  { id: "visitors", label: "visitors" },
] as const;

function Verified({ v }: { v: BoardEntry["verified"] }) {
  if (v === "ok") return <Badge title="The server replayed this run and got the same score.">verified</Badge>;
  if (v === "pending") return <Badge tone="sun">checking</Badge>;
  return (
    <Badge tone="coral" title="The replay did not match: unranked.">
      unverified
    </Badge>
  );
}

function Row({ e, me, onOpenFriend }: { e: BoardEntry; me: boolean; onOpenFriend?: (id: TokenIdStr) => void }) {
  const who = e.tokenId !== null ? `#${e.tokenId}` : e.entrant;
  return (
    <tr className={me ? "pl-row-me" : undefined} aria-current={me ? "true" : undefined}>
      <td className="pl-num-cell">{e.rank}</td>
      <td>
        {e.tokenId !== null && onOpenFriend ? (
          <Button variant="quiet" size="small" onClick={() => onOpenFriend(e.tokenId as TokenIdStr)}>
            {who}
          </Button>
        ) : (
          who
        )}
        {me && <span className="pl-sr-only"> (you)</span>}
      </td>
      <td className="pl-num-cell">{formatInt(e.score)}</td>
      <td>
        <Verified v={e.verified} />
      </td>
    </tr>
  );
}

/** Today's Daily Run leaderboard with owner / visitor tabs. */
export function DailyBoard({
  seed,
  board,
  onBoardChange,
  data,
  onRetry,
  onPlay,
  onOpenFriend,
  now: fixedNow,
}: DailyBoardProps) {
  const now = useNow(1000, fixedNow);
  return (
    <div className="pl-page">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">daily stone</h1>
        {onPlay && (
          <Button variant="now" onClick={onPlay}>
            ▶ play today's island
          </Button>
        )}
      </header>
      {seed && (
        <Card variant="ink" aria-label="today">
          <div className="pl-row" style={{ justifyContent: "space-between" }}>
            <span className="pl-label">{seed.day} · same island for everyone</span>
            <span>
              <span className="pl-label">next island in </span>
              <span className="pl-num" style={{ fontSize: 22 }} role="timer" aria-live="off">
                {formatClock(seed.endsAt - now)}
              </span>
            </span>
          </div>
        </Card>
      )}
      <p className="pl-sub" style={{ margin: 0 }}>
        One ranked attempt per Friend per UTC day. Only replays the server verifies rank. Rewards are status only: rank,
        streak, a +3 px nap, banners. No RF prizes.
      </p>
      <Tabs label="board" tabs={BOARDS} value={board} onChange={onBoardChange}>
        <RemoteView value={data} {...(onRetry ? { onRetry } : {})}>
          {(res) =>
            res.entries.length === 0 ? (
              <EmptyState
                glyph="▦"
                title="no runs yet today"
                action={onPlay && <Button onClick={onPlay}>be first</Button>}
              >
                {board === "visitors"
                  ? "Guest runs appear here (unverified, top 100)."
                  : "Owners' verified runs appear here."}
              </EmptyState>
            ) : (
              <div className="pl-stack">
                {board === "visitors" && (
                  <p className="pl-label" style={{ margin: 0 }}>
                    guest board · unverified · top 100
                  </p>
                )}
                <div className="pl-table-wrap">
                  <table className="pl-table">
                    <caption className="pl-sr-only">
                      {board} board for {res.day}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">friend</th>
                        <th scope="col">score</th>
                        <th scope="col">replay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {res.entries.map((e) => (
                        <Row
                          key={e.runId}
                          e={e}
                          me={res.me?.runId === e.runId}
                          {...(onOpenFriend ? { onOpenFriend } : {})}
                        />
                      ))}
                      {res.me && !res.entries.some((e) => e.runId === res.me?.runId) && (
                        <Row e={res.me} me {...(onOpenFriend ? { onOpenFriend } : {})} />
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          }
        </RemoteView>
      </Tabs>
    </div>
  );
}
