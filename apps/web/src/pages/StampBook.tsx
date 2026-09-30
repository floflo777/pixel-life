/**
 * The Stamp Book and the Fling Belt ladder (GDD §12.4–12.5), from `GET /api/home/:tokenId` (held stamps, belt, XP) and,
 * for the owner, `GET /api/meta/me` stats (progress toward the counting stamps). Stamps and belts are status only:
 * they never pay Bits or RF (tokenomics §7).
 */
import {
  BELTS,
  beltRank,
  type HomeView,
  type MetaStats,
  nextBelt,
  STAMP_XP,
  type StampColor,
  type StampPage,
  STAMPS,
} from "@pl/shared";
import { useState } from "react";
import { Badge, Card, formatInt, ProgressBlocks, Tabs, type Tone } from "../ui/index.js";
import { cssColor, stampProgress } from "./meta-view.js";

/** Props of {@link StampBook}. */
export interface StampBookProps {
  home: HomeView;
  /** The owner's counters (progress bars); null for visitors. */
  stats: MetaStats | null;
  /** True when the viewer owns this Friend. */
  own: boolean;
}

const PAGES: readonly { id: StampPage; label: string }[] = [
  { id: "pixel-life", label: "pixel life" },
  { id: "care", label: "care" },
  { id: "hub", label: "sky" },
];

/** Stamp colour → pill tone (easy meadow, medium sun, hard coral, extreme lilac). */
export const STAMP_TONE: Readonly<Record<StampColor, Tone>> = {
  easy: "meadow",
  medium: "sun",
  hard: "coral",
  extreme: "lilac",
};

const dateOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The belt ladder: passed rungs solid, the worn one marked, the next one with its trial. */
export function BeltLadder({ belt }: { belt: HomeView["belt"] }) {
  const worn = belt === null ? 0 : beltRank(belt);
  const next = nextBelt(belt);
  return (
    <ol className="pl-belts" aria-label="fling belts">
      {BELTS.map((b, i) => {
        const rank = i + 1;
        const done = rank <= worn;
        return (
          <li
            key={b.id}
            className={done ? "pl-belt" : "pl-belt pl-belt--todo"}
            aria-current={rank === worn ? "step" : undefined}
          >
            <span className="pl-belt-band" style={{ background: cssColor(b.color) }} aria-hidden="true" />
            <span>
              <strong>{b.name}</strong> <span className="pl-sub">{b.hint}</span>
            </span>
            <span className="pl-label">
              {rank === worn ? "worn" : done ? "passed" : b.id === next ? (b.trial ? "next trial" : "next") : "locked"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The book: summary, belts, and the three stamp pages. */
export function StampBook({ home, stats, own }: StampBookProps) {
  const [page, setPage] = useState<StampPage>("pixel-life");
  const held = new Map(home.stamps.map((s) => [s.id as string, s.at]));
  const onPage = STAMPS.filter((s) => s.page === page);
  const maxXp = STAMPS.reduce((t, s) => t + STAMP_XP[s.color], 0);
  return (
    <>
      <Card title="book" aria-label="stamp summary">
        <div className="pl-stack">
          <p style={{ margin: 0 }}>
            <span className="pl-num" style={{ fontSize: 22 }}>
              {home.stamps.length}/{STAMPS.length}
            </span>{" "}
            stamps · <span className="pl-num">{formatInt(home.stampXp)}</span> xp
          </p>
          <ProgressBlocks
            value={home.stampXp}
            max={maxXp}
            blocks={24}
            label="stamp xp"
            valueText={`${home.stampXp} of ${maxXp} xp`}
            tone="gold"
          />
          <p className="pl-sub" style={{ margin: 0 }}>
            Stamps and belts are for showing off: they unlock flex items in the catalogue and never pay Bits or RF.
          </p>
        </div>
      </Card>

      <Card title="fling belts">
        <BeltLadder belt={home.belt} />
        {own && (
          <p className="pl-sub" style={{ marginBottom: 0 }}>
            Trials are fixed-seed runs of Pixel Life; each belt needs the one before it.
          </p>
        )}
      </Card>

      <Card title="stamps">
        <Tabs label="stamp page" tabs={PAGES} value={page} onChange={setPage}>
          <ul className="pl-stamps" aria-label={`${onPage.length} stamps`}>
            {onPage.map((def) => {
              const at = held.get(def.id);
              const progress = stats && at === undefined ? stampProgress(def, stats) : null;
              return (
                <li key={def.id} className={at === undefined ? "pl-stamp pl-stamp--locked" : "pl-stamp"}>
                  <span
                    className={`pl-stamp-seal pl-tone-${STAMP_TONE[def.color]}`}
                    aria-hidden="true"
                    style={at === undefined ? { opacity: 0.3 } : undefined}
                  >
                    {at === undefined ? "?" : "✓"}
                  </span>
                  <strong>
                    {def.name}
                    <span className="pl-sr-only">{at === undefined ? " (not earned yet)" : " (earned)"}</span>
                  </strong>
                  <span className="pl-sub">{def.hint}</span>
                  <span className="pl-row" style={{ gap: 4 }}>
                    <Badge tone={STAMP_TONE[def.color]}>{def.color}</Badge>
                    <span className="pl-label">{STAMP_XP[def.color]} xp</span>
                  </span>
                  {at !== undefined && <span className="pl-label">earned {dateOf(at)}</span>}
                  {progress && (
                    <ProgressBlocks
                      value={progress.have}
                      max={progress.need}
                      blocks={Math.min(10, progress.need)}
                      label={def.name}
                      valueText={`${progress.have} of ${progress.need}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Tabs>
      </Card>
    </>
  );
}
