/**
 * Golden determinism corpus (architecture §5): seeded random and bot-played input logs with their committed final
 * hashes. `buildCorpus()` regenerates the cases (only when rules change, deliberately); `checkCorpus()` replays them and
 * is what Node tests and the cross-browser Playwright page both run, so every engine is held to the same hashes.
 */
import { FRIEND_FIXTURES, fixtureAppearance } from "../__fixtures__/friends.js";
import { EMPTY_MASK, fromIndices, toIndices } from "../bitmap.js";
import { frontMask } from "../friend.js";
import type { SimConfig, SimInput } from "../sim-types.js";
import { BOT_PROFILES, playBot } from "./bot.js";
import { inputsFromBase64, inputsToBase64 } from "./codec.js";
import { Rng } from "./rng.js";
import { replay } from "./sim.js";
import { ARENAS } from "./tuning.js";

/** One corpus case: a config, a base64 input log and the expected results. */
export interface GoldenCase {
  id: string;
  cfg: SimConfig;
  log: string;
  finalHash: string;
  score: number;
}

/** Result of checking one case. */
export interface GoldenResult {
  id: string;
  ok: boolean;
  expected: string;
  got: string;
}

/** Replays every case and compares hash and score. Pure: runs identically in Node and in any browser. */
export function checkCorpus(cases: readonly GoldenCase[]): GoldenResult[] {
  return cases.map((c) => {
    const s = replay(c.cfg, inputsFromBase64(c.log));
    return {
      id: c.id,
      ok: s.finalHash === c.finalHash && s.score === c.score,
      expected: c.finalHash,
      got: s.finalHash,
    };
  });
}

/** Number of seeded random-input cases and bot-played cases. */
export const RANDOM_CASES = 200;
/** See RANDOM_CASES. */
export const BOT_CASES = 40;

function randomConfig(rng: Rng, i: number): SimConfig {
  const fx = FRIEND_FIXTURES[rng.int(FRIEND_FIXTURES.length)] ?? FRIEND_FIXTURES[0];
  if (!fx) throw new Error("No fixture Friends.");
  const a = fixtureAppearance(fx);
  const front = frontMask(a);
  const idx = toIndices(front);
  const lostN = rng.int(3) === 0 ? rng.int(Math.floor(idx.length / 2) + 1) : 0;
  const lost: number[] = [];
  for (const p of idx) if (lost.length < lostN && rng.int(2) === 0) lost.push(p);
  const present = idx.filter((p) => !lost.includes(p));
  const goldN = rng.int(3);
  const gold: number[] = [];
  for (let g = 0; g < goldN && present.length > 0; g++) gold.push(present[rng.int(present.length)] ?? 0);
  const arenas = Object.keys(ARENAS);
  const friend: SimConfig["friend"] = {
    front,
    lost: lost.length ? fromIndices(lost) : EMPTY_MASK,
    familyId: a.familyId,
    goldHeld: goldN,
  };
  if (gold.length) friend.gold = fromIndices(gold);
  return {
    seed: rng.u32() | 0,
    kind: i % 4 === 0 ? "daily" : "free",
    arena: arenas[rng.int(arenas.length)] ?? "meadow",
    friend,
  };
}

function randomLog(rng: Rng): SimInput[] {
  const log: SimInput[] = [];
  let t = rng.int(120);
  const gap = 15 + rng.int(90);
  while (t < 3700) {
    if (rng.int(5) === 0) log.push({ t, k: 1, dir: rng.int(4096), on: rng.int(2) === 0 ? 0 : 1 });
    else log.push({ t, k: 0, ang: rng.int(4096), pow: rng.int(1024) });
    // Sometimes several inputs on one tick, sometimes long silences.
    t += rng.int(8) === 0 ? 0 : 1 + rng.int(gap * 2);
  }
  return log;
}

/** Regenerates the corpus from scratch (deterministic). Only for deliberate rule changes. */
export function buildCorpus(): GoldenCase[] {
  const out: GoldenCase[] = [];
  for (let i = 0; i < RANDOM_CASES; i++) {
    const rng = new Rng(i, 0x60 + 1);
    const cfg = randomConfig(rng, i);
    const inputs = randomLog(rng);
    const s = replay(cfg, inputs);
    out.push({ id: `random-${i}`, cfg, log: inputsToBase64(inputs), finalHash: s.finalHash, score: s.score });
  }
  const profiles = Object.values(BOT_PROFILES);
  for (let i = 0; i < BOT_CASES; i++) {
    const rng = new Rng(i, 0x60 + 2);
    const cfg = randomConfig(rng, i);
    const p = profiles[i % profiles.length] ?? BOT_PROFILES.average;
    const r = playBot(cfg, p, i);
    out.push({
      id: `bot-${p.name}-${i}`,
      cfg,
      log: inputsToBase64(r.inputs),
      finalHash: r.summary.finalHash,
      score: r.summary.score,
    });
  }
  return out;
}
