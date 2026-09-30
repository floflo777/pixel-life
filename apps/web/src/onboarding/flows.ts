/**
 * "Where your RF goes": the exact destination of every RF a player can spend, as pure data for the explainer diagram.
 *
 * Nothing here is hand-typed: Regrow and Mend amounts come from `quote()` (the same function the server runs), market
 * fees from `marketSplit()` / `MARKET`, and the Seed Pack figures from `SEED_PACK` (RTP and edge). So the diagram, the
 * confirm dialogs and the server can never disagree.
 */
import {
  BPS,
  ECON,
  formatMicroRf,
  fromIndices,
  MARKET,
  marketSplit,
  quote,
  rtpBps,
  SEED_PACK,
  seedPackPriceMicro,
  weiToMicro,
  plantPixels,
} from "@pl/shared";
import type { SplitPart } from "../ui/index.js";

/** The four ways RF leaves a player's Friend wallet. */
export type FlowKind = "regrow" | "mend" | "market" | "seed";

/** Every flow kind, in the order the explainer shows them. */
export const FLOW_KINDS: readonly FlowKind[] = ["regrow", "mend", "market", "seed"];

/** One destination of a payment. */
export interface FlowLeg {
  /** Stable key (also a test hook). */
  key: "burn" | "stream" | "target" | "seller" | "origin" | "creator" | "reward";
  /** Short destination name. */
  label: string;
  /** One line saying what happens there. */
  hint: string;
  /** Share of the payment in basis points (the protocol constant, not a rounded ratio). */
  bps: number;
  /** Exact amount for this payment (micro-RF). Legs always sum to `totalMicro`. */
  micro: number;
  /** Swatch colour (shared with the UI kit's `SplitBar`). */
  kind: SplitPart["kind"];
}

/** A payment and where each part of it goes. */
export interface RfFlow {
  kind: FlowKind;
  /** Tab / heading name. */
  title: string;
  /** What is being bought, e.g. "12 px Regrow". */
  what: string;
  /** Total paid (micro-RF). */
  totalMicro: number;
  legs: FlowLeg[];
  /** One line of context under the diagram. */
  note: string;
  /** True when the amounts are an average over many purchases rather than one exact payment (Seed Pack). */
  expected: boolean;
}

/** Inputs of {@link rfFlow}. Every field is optional; defaults give a readable example. */
export interface FlowInput {
  /** Pixels for Regrow / Mend (1..256, default 10). */
  pixels?: number;
  /** Gold Pixel sale price (micro-RF, default the 45 RF backing floor). Rounded down to a whole market tick. */
  priceMicro?: number;
  /** Seed Packs bought (1..99, default 1). */
  packs?: number;
  /** Name of the mended Friend, e.g. "#7730" (default "that Friend"). */
  targetName?: string;
  /** Name of the Friend that grew the Gold, e.g. "#7730" (default "the Friend that grew it"). */
  originName?: string;
}

/** Example token ids used only to build a quote; they never appear in the output. */
const PAYER = "1";
const TARGET = "2";

function clampInt(v: number | undefined, lo: number, hi: number, dflt: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

/** A mask with exactly `n` pixels set (which pixels does not matter for pricing). */
function maskOf(n: number) {
  return fromIndices(Array.from({ length: n }, (_, i) => i));
}

/** Seed Pack expected split in bps: RTP back as rewards, the edge half burned, half streamed (tokenomics S3). */
export function seedPackBps(): { reward: number; burn: number; stream: number } {
  const reward = rtpBps(SEED_PACK);
  const edge = BPS - reward;
  const burn = Math.floor(edge / 2);
  return { reward, burn, stream: edge - burn };
}

/** Splits `total` by bps, rounding each leg down and giving the dust to the first leg, so legs sum to `total`. */
function byBps(total: number, bps: readonly number[]): number[] {
  const out = bps.map((b) => Math.floor((total * b) / BPS));
  const dust = total - out.reduce((s, v) => s + v, 0);
  out[0] = (out[0] ?? 0) + dust;
  return out;
}

/**
 * Where the RF of one payment goes. Guarantees: legs are non-negative integers that sum to `totalMicro`, and each
 * leg's `bps` is the protocol constant (Regrow/Mend 50/50, market 95/2/2/1, Seed Pack RTP / edge halves).
 */
export function rfFlow(kind: FlowKind, input: FlowInput = {}): RfFlow {
  const target = input.targetName ?? "that Friend";
  switch (kind) {
    case "regrow": {
      const px = clampInt(input.pixels, 1, ECON.maxPxPerAction, 10);
      const q = quote({ kind: "regrow", tokenId: PAYER, pixels: maskOf(px) });
      return {
        kind,
        title: "Regrow",
        what: `${px} px Regrow on your own Friend`,
        totalMicro: q.totalMicro,
        legs: [
          {
            key: "burn",
            label: "burned",
            hint: "destroyed for good: total RF supply goes down",
            bps: ECON.burnBps,
            micro: q.burnMicro,
            kind: "burn",
          },
          {
            key: "stream",
            label: "every active Friend",
            hint: "the protocol stream, shared by all active Friends",
            bps: ECON.streamBps,
            micro: q.streamMicro,
            kind: "stream",
          },
        ],
        note: "Waiting is free: scars also heal on their own, one pixel every 2 hours.",
        expected: false,
      };
    }
    case "mend": {
      const px = clampInt(input.pixels, 1, ECON.maxPxPerAction, 10);
      const q = quote({ kind: "mend", payer: PAYER, target: TARGET, pixels: maskOf(px) });
      return {
        kind,
        title: "Mend",
        what: `${px} px Mend on ${target}`,
        totalMicro: q.totalMicro,
        legs: [
          {
            key: "burn",
            label: "burned",
            hint: "destroyed for good: total RF supply goes down",
            bps: ECON.burnBps,
            micro: q.burnMicro,
            kind: "burn",
          },
          {
            key: "target",
            label: `${target}'s wallet`,
            hint: "paid into the mended Friend's own wallet, in the same transaction",
            bps: ECON.targetBps,
            micro: q.toTargetMicro,
            kind: "friend",
          },
        ],
        note: `Mend costs 2x Regrow, so mending your own alt is never cheaper. A Friend can receive ${ECON.mendReceivedDailyPxCap} mended px a day.`,
        expected: false,
      };
    }
    case "market": {
      const raw = clampInt(input.priceMicro, MARKET.minPriceMicro, MARKET.maxPriceMicro, MARKET.backingMicro);
      const price = raw - (raw % MARKET.tickMicro);
      const s = marketSplit(price);
      const origin = input.originName ?? "the Friend that grew it";
      return {
        kind,
        title: "Gold market",
        what: "one Gold Pixel sale",
        totalMicro: price,
        legs: [
          {
            key: "seller",
            label: "seller",
            hint: "the seller's Friend wallet",
            bps: BPS - MARKET.feeBps,
            micro: s.toSellerMicro,
            kind: "seller",
          },
          {
            key: "burn",
            label: "burned",
            hint: "destroyed for good",
            bps: MARKET.burnBps,
            micro: s.burnedMicro,
            kind: "burn",
          },
          {
            key: "origin",
            label: `royalty to ${origin}`,
            hint: "on every resale, forever",
            bps: MARKET.originBps,
            micro: s.toOriginMicro,
            kind: "friend",
          },
          {
            key: "creator",
            label: "game creator",
            hint: "the only cut the game takes",
            bps: MARKET.creatorBps,
            micro: s.toCreatorMicro,
            kind: "creator",
          },
        ],
        note: `Every Gold Pixel stays redeemable for ${formatMicroRf(MARKET.backingMicro, 0)} RF, so that is the floor price.`,
        expected: false,
      };
    }
    case "seed": {
      const packs = clampInt(input.packs, 1, 99, 1);
      const total = packs * seedPackPriceMicro();
      const b = seedPackBps();
      const [reward = 0, burn = 0, stream = 0] = byBps(total, [b.reward, b.burn, b.stream]);
      return {
        kind,
        title: "Seed Pack",
        what: packs === 1 ? "one Seed Pack" : `${packs} Seed Packs`,
        totalMicro: total,
        legs: [
          {
            key: "reward",
            label: "back as rewards",
            hint: "seeds and Gold Pixels you keep or redeem for RF",
            bps: b.reward,
            micro: reward,
            kind: "reward",
          },
          {
            key: "burn",
            label: "burned",
            hint: "half of the house edge, swept weekly",
            bps: b.burn,
            micro: burn,
            kind: "burn",
          },
          {
            key: "stream",
            label: "every active Friend",
            hint: "the other half of the edge, to the protocol stream",
            bps: b.stream,
            micro: stream,
            kind: "stream",
          },
        ],
        note: "Averages over many packs. Every prize is reserved from the stake when you buy, never from another player.",
        expected: true,
      };
    }
  }
}

/** One Seed Pack outcome for the odds table. */
export interface SeedOdd {
  name: string;
  chanceBps: number;
  rewardMicro: number;
  /** Pixels planting it regrows (0 for the Gold Pixel, which is kept for its perk or sold). */
  plantPx: number;
}

/** The published Seed Pack table with each outcome's plant value. */
export function seedOdds(): SeedOdd[] {
  return SEED_PACK.outcomes.map((o, i) => {
    const rewardMicro = weiToMicro(o.reward);
    const isGold = i === SEED_PACK.outcomes.length - 1;
    return { name: o.name, chanceBps: o.chanceBps, rewardMicro, plantPx: isGold ? 0 : plantPixels(rewardMicro) };
  });
}

/** Legs as `SplitBar` parts (for places that want the kit's static bar instead of the animated diagram). */
export function flowParts(flow: RfFlow): SplitPart[] {
  return flow.legs.map((l) => ({ label: l.label, bps: l.bps, kind: l.kind, micro: l.micro }));
}
