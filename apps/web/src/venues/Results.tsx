/**
 * The results card (GDD §6.4): silhouette with this run's scars, score, pixels kept / lost, Bits earned, new stamps,
 * then PLAY AGAIN (the one lime action), share (PNG), and the owner / guest follow-ups (regrow, heal timer, bring your
 * own Friend, walk into the sky). Verification problems are stated plainly.
 */
import { effectiveLost, type FriendView, frontMask, nextRegrowthAt, popcount, quote } from "@pl/shared";
import { useEffect, useRef, useState } from "react";
import { formatDuration, formatRf, formatScore } from "../lib/format.js";
import type { RunReward } from "../meta/progress.js";
import { STAMPS } from "../meta/progress.js";
import { shareOrDownload } from "../share/share-card.js";
import { FriendSprite } from "../ui/FriendSprite.js";
import { Button, Card, LinkButton, SimTag, Stat } from "../ui/kit.js";
import type { ReportedRun } from "./host.js";

/** Props of {@link Results}. */
export interface ResultsProps {
  run: ReportedRun;
  /** The Friend after the run (scars applied). */
  view: FriendView;
  reward: RunReward;
  onPlayAgain(): void;
}

/** The results card. */
export function Results({ run, view, reward, onPlayAgain }: ResultsProps) {
  const head = useRef<HTMLHeadingElement>(null);
  const [shareState, setShareState] = useState<string | null>(null);
  useEffect(() => head.current?.focus(), []);

  const now = Date.now();
  const tokenId = view.appearance.tokenId;
  const front = frontMask(view.appearance);
  const total = popcount(front);
  // The identity already carries this run's scars (guest: local copy; owner: the server's ack).
  const lostNow = effectiveLost(view.pub.scars, now, tokenId);
  const runLost = popcount(run.result.claimed.lostDelta);
  const kept = total - popcount(lostNow);
  const next = nextRegrowthAt(view.pub.scars, now, tokenId);
  const regrowPx = popcount(lostNow);
  const regrowPrice = regrowPx > 0 ? quote({ kind: "regrow", tokenId, pixels: lostNow }).totalMicro : 0;
  const link = `${location.origin}/f/${tokenId}`;

  const share = async (): Promise<void> => {
    setShareState("making the card…");
    try {
      const r = await shareOrDownload({
        appearance: view.appearance,
        lost: lostNow,
        score: run.result.claimed.score,
        kept,
        total,
        loaned: view.loaned,
        link: view.loaned ? location.origin : link,
      });
      setShareState(r === "shared" ? "shared!" : r === "downloaded" ? "card downloaded" : null);
    } catch (e) {
      setShareState(e instanceof Error ? e.message : "Could not make the card.");
    }
  };

  return (
    <Card className="results" labelledBy="results-title">
      <h2 id="results-title" className="display" tabIndex={-1} ref={head}>
        RUN OVER
      </h2>
      <div className="results-body">
        <FriendSprite view={view} lost={lostNow} scale={8} label={`#${tokenId} after the run`} />
        <div className="results-stats">
          <Stat label="score">
            <span className="num big" data-testid="result-score">
              {formatScore(run.result.claimed.score)}
            </span>
          </Stat>
          <Stat label="kept">
            <span className="num">
              {kept}/{total} px
            </span>
          </Stat>
          <Stat label="lost (scars)">
            <span className="num">{runLost}</span>
          </Stat>
          <Stat label="bits">
            <span className="num">+{reward.bits}</span>
            {reward.firstRunOfDay && <span className="mono"> first run today</span>}
          </Stat>
          {reward.newStamps.length > 0 && (
            <Stat label="new stamps">{reward.newStamps.map((s) => STAMPS[s].name).join(", ")}</Stat>
          )}
        </div>
      </div>
      {run.problem && (
        <p className="results-problem" role="alert">
          {run.problem}
        </p>
      )}
      <div className="results-actions">
        <Button variant="now" big onClick={onPlayAgain} data-testid="play-again">
          PLAY AGAIN
        </Button>
        <Button onClick={() => void share()}>share card</Button>
        {shareState && (
          <span className="mono" role="status">
            {shareState}
          </span>
        )}
      </div>
      {view.loaned ? (
        <div className="results-follow">
          <p>These were loaner pixels. Your own Friend's scars stick, and heal.</p>
          <LinkButton to="/connect">bring your own Friend</LinkButton>
        </div>
      ) : (
        regrowPx > 0 && (
          <div className="results-follow">
            <LinkButton to="/regrow">
              regrow {regrowPx} · {formatRf(regrowPrice)}
            </LinkButton>
            <SimTag live={view.pub.economy === "live"} />
            {next !== null && <p className="mono">next pixel heals free in {formatDuration(next - now)}</p>}
          </div>
        )
      )}
      <LinkButton to="/sky">walk into the sky →</LinkButton>
    </Card>
  );
}
