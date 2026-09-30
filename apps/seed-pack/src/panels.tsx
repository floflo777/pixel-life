import type { ChanceGameDefinition, GameSnapshot } from "@rarefriends/friendsdk/game";
import { PixelArt, spriteForRarity } from "./art";
import { economyTerms, formatBps, formatRf, oddsTable } from "./economy";
import { GOLD_REGROWTH_MAX_COUNT, goldMultiplierText } from "./rules";

/** Small "simulated" chip appended to every amount while the client is in preview mode. */
export function Sim({ on }: { on: boolean }) {
  return on ? <span className="sp-sim">simulated</span> : null;
}

/** Published odds: exact %, bps, RF value and EV share per outcome, plus EV, RTP, edge and live backing. */
export function OddsPanel({
  definition,
  snapshot,
  simulated,
}: {
  definition: ChanceGameDefinition;
  snapshot: GameSnapshot;
  simulated: boolean;
}) {
  const rows = oddsTable(definition);
  const terms = economyTerms(definition);
  return (
    <section className="sp-panel sp-odds" aria-labelledby="sp-odds-title">
      <h2 id="sp-odds-title">Published odds</h2>
      <table>
        <caption className="sp-visually-hidden">
          Seed Pack outcomes: chance, fixed RF value and expected-value share
        </caption>
        <thead>
          <tr>
            <th scope="col">Outcome</th>
            <th scope="col">Chance</th>
            <th scope="col">Value</th>
            <th scope="col">EV share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.outcomeId} data-rarity={row.rarity}>
              <th scope="row">
                <PixelArt name={spriteForRarity(row.rarity)} className="sp-icon" />
                <span>{row.name}</span>
              </th>
              <td>
                <span className="sp-num">{formatBps(row.chanceBps)} %</span>
                <span className="sp-bar" aria-hidden="true">
                  <i style={{ width: `${row.chanceBps / 100}%` }} />
                </span>
                <small>{row.chanceBps.toLocaleString("en-US")} bps</small>
              </td>
              <td>
                <span className="sp-num">{formatRf(row.reward)}</span> RF
              </td>
              <td>
                <span className="sp-num">{formatRf(row.evContribution, 2)}</span> RF
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="sp-terms">
        <div>
          <dt>Pack price</dt>
          <dd>
            {formatRf(terms.price)} RF <Sim on={simulated} />
          </dd>
        </div>
        <div>
          <dt>Expected value</dt>
          <dd>
            {formatRf(terms.expected, 2)} RF per pack · RTP {formatBps(terms.rtpBps)} % · edge{" "}
            {formatBps(terms.edgeBps)} %
          </dd>
        </div>
        <div>
          <dt>Price back or better</dt>
          <dd>{formatBps(terms.atLeastPriceBps)} % of packs</dd>
        </div>
        <div>
          <dt>Max prize</dt>
          <dd>{formatRf(terms.maxPrize)} RF, reserved from the prize stake for every pack at purchase</dd>
        </div>
        <div>
          <dt>Backing now</dt>
          <dd>
            free {formatRf(snapshot.freeStake)} · unopened {formatRf(snapshot.reservedPlays)} · kept{" "}
            {formatRf(snapshot.rewardLiability)} RF <Sim on={simulated} />
          </dd>
        </div>
      </dl>
      <p className="sp-fine">
        One pack gives exactly one reward. The result is fixed when the pack is settled; the animation only presents it.
        No rerolls. Kept rewards never expire and redeem at their fixed value.
      </p>
    </section>
  );
}

/** Kept rewards with their fixed value and a one-at-a-time redeem control. */
export function InventoryPanel({
  definition,
  snapshot,
  simulated,
  disabled,
  onRedeem,
}: {
  definition: ChanceGameDefinition;
  snapshot: GameSnapshot;
  simulated: boolean;
  disabled: boolean;
  onRedeem: (outcomeId: number) => void;
}) {
  const rows = oddsTable(definition);
  const total = snapshot.inventory.reduce((sum, amount) => sum + amount, 0n);
  return (
    <section className="sp-panel sp-inventory" aria-labelledby="sp-inventory-title">
      <h2 id="sp-inventory-title">Inventory · {total.toString()} kept</h2>
      <ul>
        {rows.map((row, index) => {
          const held = snapshot.inventory[index] ?? 0n;
          return (
            <li key={row.outcomeId} data-rarity={row.rarity} data-held={held > 0n || undefined}>
              <PixelArt name={spriteForRarity(row.rarity)} className="sp-icon" />
              <span className="sp-item">
                <strong>{row.name}</strong>
                <small>
                  ×{held.toString()} · {formatRf(row.reward)} RF each <Sim on={simulated} />
                </small>
              </span>
              <button
                type="button"
                className="sp-btn sp-small"
                disabled={disabled || held === 0n}
                onClick={() => onRedeem(row.outcomeId)}
                aria-label={`Redeem one ${row.name} for ${formatRf(row.reward)} RF${simulated ? " (simulated)" : ""}`}
              >
                Redeem 1
              </button>
            </li>
          );
        })}
      </ul>
      <p className="sp-fine">
        Held rewards belong to this Friend&rsquo;s canonical wallet. A held Gold Pixel is read live by Pixel Life (gold
        voxel, free regrowth ×{goldMultiplierText()} each, {GOLD_REGROWTH_MAX_COUNT} at most); redeeming it removes the
        perk.
      </p>
    </section>
  );
}
