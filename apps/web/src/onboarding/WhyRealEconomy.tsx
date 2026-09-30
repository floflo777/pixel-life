/**
 * "Why this is a real economy": one screen for judges. Six claims, each with the number or mechanism that backs it and
 * where to check it. Figures are read from `ECON` / `MARKET` / `SEED_PACK`, never typed in, and the section states
 * plainly what is simulated today and what is not deployed.
 */
import { BPS, ECON, type EconomyMode, MARKET } from "@pl/shared";
import type { ReactNode } from "react";
import { cx, formatBps, formatRf, SimulatedBadge } from "../ui/index.js";
import { seedPackBps } from "./flows.js";

/** Public contracts spec (the repo is public; the page links there so judges read the source, not our summary). */
export const CONTRACTS_README_URL = "https://github.com/floflo777/pixel-life/blob/main/contracts/README.md";

/** One claim on the judges' screen. */
export interface EconomyClaim {
  id: string;
  /** The headline number or word. */
  stat: string;
  title: string;
  /** One or two plain sentences. */
  body: string;
  /** Where it is enforced. */
  proof: string;
}

/** The six claims, computed from the protocol constants. */
export function economyClaims(): EconomyClaim[] {
  const seed = seedPackBps();
  const fee = (bps: number): string => formatBps(bps).replace(" ", "");
  return [
    {
      id: "no-mint",
      stat: "0 RF",
      title: "No RF is minted",
      body: "The game has no mint. Every RF it touches comes from a player's own Friend wallet.",
      proof: "PixelLifeSink has no storage and holds 0 RF after every call (tested).",
    },
    {
      id: "no-transfer",
      stat: "0 wagers",
      title: "No loser pays a winner",
      body: "No wagers, no prize pool, no RF for playing. Runs earn Bits, which never convert to RF. Seed Pack prizes come from a reserved stake.",
      proof: "Seed Pack = FriendSDK ChanceGame: each pack's max prize is reserved at purchase.",
    },
    {
      id: "burn",
      stat: fee(ECON.burnBps),
      title: "Every spend splits 50/50",
      body: `Regrow: ${fee(ECON.burnBps)} burned, ${fee(ECON.streamBps)} to every active Friend. Mend: ${fee(ECON.burnBps)} burned, ${fee(ECON.targetBps)} to the mended Friend. Seed Pack edge: ${fee(seed.burn)} burned, ${fee(seed.stream)} streamed.`,
      proof: "The protocol's 50/50 rule, as constants in @pl/shared and PixelLifeSink.",
    },
    {
      id: "mend",
      stat: fee(ECON.targetBps),
      title: "Friends earn from Mend",
      body: `When a stranger mends your Friend, half the price lands in your Friend's own wallet, in the same transaction. Up to ${ECON.mendReceivedDailyPxCap} px a day.`,
      proof: `${formatRf(ECON.mendMicroPerPx)}/px = 2x Regrow, so mending your own alt never pays.`,
    },
    {
      id: "market",
      stat: fee(MARKET.feeBps),
      title: "Gold Pixel market, with royalties",
      body: `Fee on each sale: ${fee(MARKET.burnBps)} burned, ${fee(MARKET.originBps)} to the Friend that grew the Gold, ${fee(MARKET.creatorBps)} to the creator. Seller keeps ${fee(BPS - MARKET.feeBps)}.`,
      proof: `Every Gold stays redeemable for ${formatRf(MARKET.backingMicro, 0)}: a hard floor.`,
    },
    {
      id: "contracts",
      stat: "live-ready",
      title: "Contracts written and tested",
      body: "Regrow and Mend run in PixelLifeSink; the stream half goes through StreamForwarder. Foundry tests, plus a check against a local fork of the real chain.",
      proof: "Not deployed, not audited: going live needs a review and the owner's go.",
    },
  ];
}

/** Props of {@link WhyRealEconomy}. */
export interface WhyRealEconomyProps {
  mode?: EconomyMode;
  /** Link to the contracts spec (default the public repo). */
  contractsUrl?: string;
  className?: string;
  /** Extra content under the claims (e.g. the RF flow explainer). */
  children?: ReactNode;
}

/** The judges' one-screen summary of the economy. */
export function WhyRealEconomy({
  mode = "sim",
  contractsUrl = CONTRACTS_README_URL,
  className,
  children,
}: WhyRealEconomyProps) {
  const claims = economyClaims();
  return (
    <section className={cx("pl-root pl-onb-why", className)} aria-labelledby="pl-onb-why-title">
      <header className="pl-card-head">
        <h2 id="pl-onb-why-title" className="pl-display pl-h2">
          Why this is a real economy
        </h2>
        <SimulatedBadge mode={mode} />
      </header>
      <ul className="pl-onb-claims">
        {claims.map((c) => (
          <li key={c.id} className="pl-card pl-card--flat pl-onb-claim" data-claim={c.id}>
            <span className="pl-num pl-onb-stat">{c.stat}</span>
            <h3 className="pl-display pl-h3">{c.title}</h3>
            <p>{c.body}</p>
            <p className="pl-mono pl-sub pl-onb-proof">{c.proof}</p>
          </li>
        ))}
      </ul>
      <p className="pl-onb-why-foot">
        <a href={contractsUrl} target="_blank" rel="noreferrer">
          Read the contracts (contracts/README.md)
        </a>
        <span className="pl-sub">
          {" "}
          {mode === "sim"
            ? `Today every balance is SIMULATED: a demo ledger stands in for the wallet (${formatRf(ECON.simStartMicro, 0)} to start, ${formatRf(ECON.simDailyGrantMicro, 0)} a day). Live, the Regrow stream half needs the RF team's sign-off; until then it is burned.`
            : "Balances are real RF on Robinhood Chain."}
        </span>
      </p>
      {children}
    </section>
  );
}
