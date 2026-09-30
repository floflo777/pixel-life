import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RewardReveal, type RewardRevealPhase } from "@rarefriends/friendsdk/reveal";
import type { GameItem } from "@rarefriends/friendsdk/items";
import { PixelArt, spriteForRarity } from "./art";
import { formatBps, formatRf, type OddsRow } from "./economy";
import { GOLD_REGROWTH_MAX_COUNT, PLANT_PX, goldMultiplierText } from "./rules";

/** What happened, fixed by `settle` before this overlay mounts. The overlay only presents it. */
export type RevealResult = Readonly<{ playId: bigint; row: OddsRow }>;

type Props = {
  result: RevealResult;
  reducedMotion: boolean;
  disabled: boolean;
  simulated: boolean;
  friendLabel: string;
  onPhase: (phase: RewardRevealPhase, row: OddsRow) => void;
  onKeep: () => void;
  onRedeem: () => void;
};

/** How to use a kept reward; copy only, Pixel Life applies it (tokenomics §3–4, DECISIONS D-04/D-13). */
export function holdCopy(row: OddsRow): string {
  if (row.rarity === "legendary") {
    return `wear it: a gold voxel on your Friend, and free regrowth ×${goldMultiplierText()} while held (${GOLD_REGROWTH_MAX_COUNT} count at most). No in-run power.`;
  }
  const px = PLANT_PX[row.outcomeId];
  return px ? `plant it in Pixel Life to regrow ${px} px, or redeem it.` : "plant it in Pixel Life, or redeem it.";
}

/**
 * Reveal overlay: SDK `RewardReveal` scaled by rarity (common = small card … legendary = full-bleed ink hero).
 * Skip, reduced motion and keyboard are supported; keep/redeem appear once the reveal completes.
 */
export function RevealOverlay({
  result,
  reducedMotion,
  disabled,
  simulated,
  friendLabel,
  onPhase,
  onKeep,
  onRedeem,
}: Props) {
  const { row } = result;
  const [phase, setPhase] = useState<RewardRevealPhase>(reducedMotion ? "complete" : "anticipation");
  const [skip, setSkip] = useState(0);
  const keepRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const done = phase === "complete";
  const sim = simulated ? " sim" : "";
  const item = useMemo<GameItem>(
    () => ({ id: `outcome-${row.outcomeId}`, name: row.name, rarity: row.rarity }),
    [row.outcomeId, row.name, row.rarity],
  );

  useEffect(() => {
    rootRef.current?.focus();
  }, []);
  useEffect(() => {
    if (done) keepRef.current?.focus();
  }, [done]);

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (!done && (key === "escape" || key === " " || key === "enter")) {
      event.preventDefault();
      setSkip((value) => value + 1);
    } else if (done && !disabled && key === "k") {
      event.preventDefault();
      onKeep();
    } else if (done && !disabled && key === "r") {
      event.preventDefault();
      onRedeem();
    }
  }

  return (
    <div
      ref={rootRef}
      className="sp-reveal"
      data-rarity={row.rarity}
      data-phase={phase}
      data-reduced-motion={reducedMotion || undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sp-reveal-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="sp-reveal-stage">
        <RewardReveal
          item={item}
          revealKey={result.playId.toString()}
          reducedMotion={reducedMotion}
          skipSignal={skip}
          skipLabel="Skip reveal"
          className="sp-reward"
          onPhase={(next) => {
            setPhase(next);
            onPhase(next, row);
          }}
          slots={{
            itemArt: <PixelArt name={spriteForRarity(row.rarity)} />,
            ...(row.rarity === "legendary" ? { backdrop: <GoldBackdrop /> } : {}),
          }}
        />
      </div>
      <div className="sp-result" hidden={!done}>
        <p className="sp-result-kicker">
          {row.rarity === "legendary" ? `1 in ${10_000 / row.chanceBps}` : `${formatBps(row.chanceBps)} % chance`}
        </p>
        <h2 id="sp-reveal-title" className="sp-result-name">
          {row.name}
        </h2>
        <p className="sp-result-value">
          <span className="sp-num">{formatRf(row.reward)}</span> RF
          {simulated && <span className="sp-sim">simulated</span>}
        </p>
        <p className="sp-result-copy">
          Kept in {friendLabel}&rsquo;s inventory. Hold: {holdCopy(row)}
        </p>
        <div className="sp-result-actions">
          <button ref={keepRef} type="button" className="sp-btn sp-primary" disabled={disabled} onClick={onKeep}>
            Keep <kbd>K</kbd>
          </button>
          <button type="button" className="sp-btn" disabled={disabled} onClick={onRedeem}>
            Redeem · {formatRf(row.reward)} RF{sim} <kbd>R</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Gold Pixel hero backdrop: a stepped 9-point burst and a dithered sun bloom made of dots, never blur
 * (art bible §3 "dithered bloom", §8 "pop burst").
 */
function GoldBackdrop() {
  const rays = Array.from({ length: 9 }, (_, index) => index);
  return (
    <div className="sp-gold-backdrop">
      <svg className="sp-gold-burst" viewBox="-50 -50 100 100" shapeRendering="crispEdges" aria-hidden="true">
        {rays.map((index) => (
          <polygon key={index} points="0,-6 3,-48 -3,-48" transform={`rotate(${index * 40})`} />
        ))}
      </svg>
      <i className="sp-gold-bloom sp-gold-bloom-1" />
      <i className="sp-gold-bloom sp-gold-bloom-2" />
      <i className="sp-gold-bloom sp-gold-bloom-3" />
      <i className="sp-spark sp-spark-a" />
      <i className="sp-spark sp-spark-b" />
      <i className="sp-spark sp-spark-c" />
    </div>
  );
}
