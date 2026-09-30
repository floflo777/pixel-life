/**
 * Economy & odds (tokenomics §0, §3, §6, §8; contracts/README): every price, where every RF goes, the Seed Pack's
 * published odds / EV / reserve rule, what is simulated today versus live-ready, and the contracts behind live mode.
 * Every figure is computed from `ECON` / `SEED_PACK` in `@pl/shared`, so this page cannot disagree with the server.
 */
import {
  BITS,
  BPS,
  ECON,
  type EconomyMode,
  type EconomyStatsRes,
  plantPixels,
  regrowthMsPerPx,
  RF_DECOR_TIERS_MICRO,
} from "@pl/shared";
import type { ReactNode } from "react";
import {
  Badge,
  Card,
  formatAgo,
  formatBps,
  formatInt,
  formatRf,
  type Remote,
  RemoteView,
  SimulatedBadge,
  SplitBar,
  type SplitPart,
  useNow,
} from "../ui/index.js";
import {
  GOLD_FLOOR_MICRO,
  marketParts,
  MEND_PARTS,
  REGROW_PARTS,
  SEED_BANKROLL_MICRO,
  seedPackFacts,
} from "./economy.js";

/** Props of {@link EconomyPage}. */
export interface EconomyPageProps {
  /** The server's economy mode (`GET /api/me` → `economy`). */
  mode: EconomyMode;
  /** Running totals (`GET /api/stats/economy`), optional. */
  stats?: Remote<EconomyStatsRes>;
  onRetryStats?: () => void;
  now?: number;
}

/** Contract addresses and constants from contracts/README (chain 4663). None of the Pixel Life contracts is deployed. */
export const CONTRACTS = Object.freeze({
  chainId: 4663,
  rf: "0x0779369854d3EcdEA927206718FFD7730C67B71f",
  generations: "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D",
});

type Status = "live-ready" | "simulated" | "needs RF team" | "spec only" | "off-chain";

/** Simulated-vs-live status of each piece (tokenomics §8, contracts/README). */
export const LIVE_STATUS: readonly { piece: string; status: Status; how: string }[] = [
  {
    piece: "Seed Pack (buy · play · settle · redeem)",
    status: "live-ready",
    how: "FriendSDK ChanceGame with the published table; no new contract. The MVP runs the SDK preview, labelled simulated.",
  },
  {
    piece: "Gold Pixel regrowth perk",
    status: "live-ready",
    how: "read-only: ChanceGame.balanceOf(Friend wallet, 4).",
  },
  {
    piece: "Mend (50 % to the Friend's wallet)",
    status: "live-ready",
    how: "PixelLifeSink.mend pays Generations.tokenBoundAccount(target) in the same call.",
  },
  {
    piece: "Regrow's stream half",
    status: "needs RF team",
    how: "StreamForwarder → ActivationManager.fund needs the RF team's sign-off; until then that half is burned.",
  },
  { piece: "Gold Pixel market", status: "spec only", how: "GoldPixelMarket.sol is a spec; trading here is simulated." },
  {
    piece: "Pixels, Bits, quotes, boards",
    status: "off-chain",
    how: "server state, recomputed and verified server-side.",
  },
];

const STATUS_TONE: Record<Status, "now" | "paper" | "coral" | "ink" | "sun"> = {
  "live-ready": "paper",
  simulated: "ink",
  "needs RF team": "sun",
  "spec only": "coral",
  "off-chain": "paper",
};

function PriceRow({ item, price, where, note }: { item: string; price: ReactNode; where: string; note?: string }) {
  return (
    <tr>
      <th
        scope="row"
        style={{ textTransform: "none", fontFamily: "inherit", fontSize: 14, color: "inherit", borderBottom: 0 }}
      >
        {item}
        {note && <div className="pl-label">{note}</div>}
      </th>
      <td className="pl-num-cell">{price}</td>
      <td>{where}</td>
    </tr>
  );
}

/** The economy transparency page. */
export function EconomyPage({ mode, stats, onRetryStats, now: fixedNow }: EconomyPageProps) {
  const now = useNow(60_000, fixedNow);
  const seed = seedPackFacts();
  const pxPerDay = (gold: number): number => Math.floor((24 * 3600_000) / regrowthMsPerPx(gold));
  const seedParts: SplitPart[] = [
    { label: "returned as redeemable rewards (EV)", kind: "reward", bps: seed.rtpBps },
    { label: "edge: burned (after weekly sweep)", kind: "burn", bps: Math.floor((BPS - seed.rtpBps) / 2) },
    {
      label: "edge: active-Friends stream",
      kind: "stream",
      bps: BPS - seed.rtpBps - Math.floor((BPS - seed.rtpBps) / 2),
    },
  ];
  const maxChance = Math.max(...seed.rows.map((r) => r.chanceBps));

  return (
    <main className="pl-root pl-page" aria-label="Economy and odds">
      <header className="pl-page-head">
        <h1 className="pl-display pl-h1">economy & odds</h1>
        <SimulatedBadge mode={mode} />
      </header>
      <Card variant="ink" aria-label="mode">
        <p style={{ margin: 0 }}>
          {mode === "sim" ? (
            <>
              <strong>Every RF amount in Pixel Life is SIMULATED right now.</strong> Each Friend gets{" "}
              {formatRf(ECON.simStartMicro, 0)} of play RF to start and {formatRf(ECON.simDailyGrantMicro, 0)} a day. No
              transaction is sent and no real tokens move. The prices and splits below are exactly what live mode would
              charge.
            </>
          ) : (
            <>
              <strong>Live RF.</strong> Payments are real RF on Robinhood Chain ({CONTRACTS.chainId}); your wallet
              confirms each one.
            </>
          )}
        </p>
      </Card>

      <Card title="every price" aria-label="every price">
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th scope="col">item</th>
                <th scope="col">price</th>
                <th scope="col">where the RF goes</th>
              </tr>
            </thead>
            <tbody>
              <PriceRow
                item="Regrow (your Friend, instant)"
                price={`${formatRf(ECON.regrowMicroPerPx)}/px`}
                where="50 % burned · 50 % active-Friends stream"
              />
              <PriceRow
                item="Mend (someone else's Friend)"
                price={`${formatRf(ECON.mendMicroPerPx)}/px`}
                where="50 % burned · 50 % into that Friend's wallet"
                note={`2 × Regrow, so an alt can't mend itself at a discount · max ${ECON.mendReceivedDailyPxCap} px/day received`}
              />
              <PriceRow
                item="Free regrowth"
                price={`${pxPerDay(0)} px/day`}
                where={`pixels only, never RF · ${pxPerDay(1)} px/day with 1 Gold Pixel, ${pxPerDay(2)} with 2+`}
              />
              <PriceRow
                item="Seed Pack"
                price={formatRf(seed.price, 0)}
                where={`${formatBps(seed.rtpBps)} back as rewards; the edge is burned / streamed 50/50`}
              />
              <PriceRow
                item="Plant a seed"
                price="its reward"
                where={`redeem, then Regrow with +${formatBps(ECON.plantBonusBps)} bonus pixels (e.g. ${formatRf(5_000_000, 0)} → ${plantPixels(5_000_000)} px)`}
              />
              <PriceRow
                item="Home-island decor (RF tier)"
                price={RF_DECOR_TIERS_MICRO.map((m) => formatRf(m, 0).replace(" RF", "")).join(" / ") + " RF"}
                where="50 % burned · 50 % stream"
              />
              <PriceRow
                item="Gold Pixel market"
                price={`floor ${formatRf(GOLD_FLOOR_MICRO, 0)}`}
                where="5 % fee: 2 % burned · 2 % origin Friend · 1 % creator"
                note="simulated"
              />
              <PriceRow
                item="Bits (soft currency)"
                price="earned only"
                where={`${BITS.runBase}–${BITS.runBase + BITS.runSkillMax} per run, +${BITS.firstRunOfDay} first run of the day, ${BITS.dailyHardCap}/day cap · never bought, never RF`}
              />
            </tbody>
          </table>
        </div>
      </Card>

      <section aria-label="split diagrams" className="pl-grid-2">
        <Card title="regrow" level={3}>
          <SplitBar parts={REGROW_PARTS} label={`${formatRf(ECON.regrowMicroPerPx)} per pixel`} />
          <p className="pl-sub">Until the RF team opens the stream entry point, the stream half is burned too.</p>
        </Card>
        <Card title="mend" level={3}>
          <SplitBar parts={MEND_PARTS} label={`${formatRf(ECON.mendMicroPerPx)} per pixel`} />
          <p className="pl-sub">A gift, not a prize: the mended Friend's owner gets half, in the same transaction.</p>
        </Card>
        <Card title="seed pack" level={3}>
          <SplitBar parts={seedParts} label={`${formatRf(seed.price, 0)} per pack, on average`} />
          <p className="pl-sub">
            Only profit above the {formatInt(SEED_BANKROLL_MICRO / 1_000_000)} RF bankroll is ever swept.
          </p>
        </Card>
        <Card title="gold pixel sale" level={3}>
          <SplitBar parts={marketParts()} label="of the listing price" />
        </Card>
      </section>

      <Card title="seed pack odds" aria-label="seed pack odds" actions={<SimulatedBadge mode={mode} />}>
        <div className="pl-table-wrap">
          <table className="pl-table">
            <caption className="pl-sr-only">Seed Pack outcomes, chances and fixed RF values</caption>
            <thead>
              <tr>
                <th scope="col">outcome</th>
                <th scope="col">chance</th>
                <th scope="col" aria-hidden="true" style={{ width: "30%" }} />
                <th scope="col">value</th>
                <th scope="col">plant</th>
                <th scope="col">ev</th>
              </tr>
            </thead>
            <tbody>
              {seed.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name === "Gold Pixel" ? <Badge tone="gold">gold pixel</Badge> : r.name.toLowerCase()}</td>
                  <td className="pl-num-cell">{formatBps(r.chanceBps)}</td>
                  <td aria-hidden="true">
                    <span
                      className={r.name === "Gold Pixel" ? "pl-seg-gold" : "pl-seg-burn"}
                      style={{
                        display: "block",
                        height: 12,
                        width: `${Math.max(2, (r.chanceBps * 100) / maxChance)}%`,
                        border: "2px solid var(--pl-ink)",
                      }}
                    />
                  </td>
                  <td className="pl-num-cell">{formatRf(r.rewardMicro, 0)}</td>
                  <td>{plantPixels(r.rewardMicro)} px</td>
                  <td className="pl-num-cell">{formatRf(r.evMicro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="pl-dl" style={{ marginTop: 12 }}>
          <dt>expected value</dt>
          <dd>
            <span className="pl-num">{formatRf(seed.ev)}</span> per {formatRf(seed.price, 0)} pack · RTP{" "}
            {formatBps(seed.rtpBps)} · edge {formatRf(seed.edgeMicro)}
          </dd>
          <dt>money back or better</dt>
          <dd>{formatBps(seed.moneyBackBps)} of packs</dd>
          <dt>max prize</dt>
          <dd>{formatRf(seed.max, 0)} (a Gold Pixel), reserved at purchase</dd>
          <dt>reserve rule</dt>
          <dd>
            a purchase of q packs needs free stake ≥ {formatRf(seed.max, 0)} and free + q × {formatRf(seed.price, 0)} ≥
            q × {formatRf(seed.max, 0)}: {formatRf(seed.reservePerPackMicro, 0)} free stake per pack in flight
          </dd>
          <dt>bankroll</dt>
          <dd>
            {formatInt(SEED_BANKROLL_MICRO / 1_000_000)} RF developer stake; if the reserve is short, a new purchase is
            refused and nothing is charged
          </dd>
        </dl>
        <p className="pl-sub">
          The outcome is fixed on-chain when you play; the reveal animation is only presentation, and there are no
          rerolls. Every reward is kept by your Friend with no expiry: hold it or redeem it for its fixed RF value.
        </p>
      </Card>

      <Card title="gold pixel" level={2} aria-label="gold pixel">
        <p style={{ marginTop: 0 }}>
          Holding a Gold Pixel speeds your Friend's free regrowth by {formatBps(ECON.goldRegrowthBonusBps)} each (up to{" "}
          {ECON.goldRegrowthMaxCount}) and shows it in gold. It gives <strong>no</strong> in-run power, score or rank.
          Redeeming it pays {formatRf(GOLD_FLOOR_MICRO, 0)} and ends the perk on the next read, so it is never spent
          twice.
        </p>
      </Card>

      <Card title="simulated vs live-ready" aria-label="simulated vs live-ready">
        <ul className="pl-list">
          {LIVE_STATUS.map((s) => (
            <li key={s.piece} className="pl-row" style={{ alignItems: "start" }}>
              <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
              <span style={{ flex: "1 1 240px" }}>
                <strong>{s.piece}.</strong> {s.how}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="contracts" aria-label="contracts" actions={<Badge tone="coral">not deployed · not audited</Badge>}>
        <ul className="pl-list">
          <li>
            <strong className="pl-mono">PixelLifeSink</strong>: regrow / mend paid from the Friend's own wallet; 50 %
            burned with RF.burn, 50 % to the stream forwarder (Regrow) or the target Friend's wallet (Mend). No owner,
            no pause, no withdraw; holds RF only inside a call.
          </li>
          <li>
            <strong className="pl-mono">StreamForwarder</strong>: collects Regrow's stream half; anyone can push it into
            ActivationManager.fund.
          </li>
          <li>
            <strong className="pl-mono">GoldPixelMarket</strong>: fixed-price listings with the 5 % fee split (spec
            level).
          </li>
        </ul>
        <dl className="pl-dl" style={{ marginTop: 12 }}>
          <dt>chain</dt>
          <dd>Robinhood Chain · {CONTRACTS.chainId}</dd>
          <dt>RF</dt>
          <dd className="pl-mono" style={{ wordBreak: "break-all" }}>
            {CONTRACTS.rf}
          </dd>
          <dt>Generations</dt>
          <dd className="pl-mono" style={{ wordBreak: "break-all" }}>
            {CONTRACTS.generations}
          </dd>
        </dl>
        <p className="pl-sub">
          Going live needs a security review, the RF team's answers and the owner's explicit authorization. Until then
          the server runs in simulated mode.
        </p>
      </Card>

      {stats && (
        <Card title="so far" aria-label="running totals" actions={<SimulatedBadge mode={mode} />}>
          <RemoteView value={stats} {...(onRetryStats ? { onRetry: onRetryStats } : {})}>
            {(s) => (
              <dl className="pl-dl">
                <dt>burned</dt>
                <dd className="pl-num">{formatRf(s.burnedMicro)}</dd>
                <dt>to the stream</dt>
                <dd className="pl-num">{formatRf(s.streamMicro)}</dd>
                <dt>to Friends' wallets</dt>
                <dd className="pl-num">{formatRf(s.toFriendsMicro)}</dd>
                <dt>actions</dt>
                <dd>
                  {formatInt(s.counts.regrow)} regrows · {formatInt(s.counts.mend)} mends ·{" "}
                  {formatInt(s.counts.seedPacks)} seed packs
                </dd>
                <dt>updated</dt>
                <dd className="pl-label">{formatAgo(s.updatedAt, now)}</dd>
              </dl>
            )}
          </RemoteView>
        </Card>
      )}
    </main>
  );
}
