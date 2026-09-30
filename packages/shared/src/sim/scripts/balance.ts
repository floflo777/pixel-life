/**
 * Bot-play balance report (GDD §9.7). Plays `runs` seeded runs per family × profile on an island and prints the metrics
 * the GDD difficulty curve targets. Deterministic: the same arguments always print the same numbers.
 *
 *   npx tsx packages/shared/src/sim/scripts/balance.ts [runsPerFamily=60] [arena=meadow]
 */
import { FRIEND_FIXTURES, fixtureAppearance } from "../../__fixtures__/friends.js";
import { EMPTY_MASK, fromIndices, toIndices } from "../../bitmap.js";
import { frontMask } from "../../friend.js";
import { FAMILIES } from "../../ids.js";
import type { SimConfig } from "../../sim-types.js";
import { BOT_PROFILES, type BotProfile, type BotRun, playBot } from "../bot.js";

const out = (globalThis as { console?: { log(...a: unknown[]): void } }).console;
const print = (...a: unknown[]): void => out?.log(...a);
const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
const RUNS = Number(argv[2] ?? 60);
const ARENA = argv[3] ?? "meadow";

/** One representative real Friend per family (friends.json fixtures). */
function familyFriends(): { family: string; cfg: (seed: number, bodyShare?: number) => SimConfig }[] {
  return FAMILIES.map((family) => {
    const fx = FRIEND_FIXTURES.find((f) => f.family === family);
    if (!fx) throw new Error(`No fixture for ${family}`);
    const a = fixtureAppearance(fx);
    const front = frontMask(a);
    return {
      family,
      cfg: (seed: number, bodyShare = 1): SimConfig => {
        // A pre-scarred body (e.g. 70 %): drop pixels in index order from the bottom-right, deterministic.
        const idx = toIndices(front);
        const drop = Math.round(idx.length * (1 - bodyShare));
        const lost = drop > 0 ? fromIndices(idx.slice(idx.length - drop)) : EMPTY_MASK;
        return { seed, kind: "free", arena: ARENA, friend: { front, lost, familyId: a.familyId, goldHeld: 0 } };
      },
    };
  });
}

interface Agg {
  n: number;
  scores: number[];
  persisted: number;
  off: number;
  recovered: number;
  crumbled: number;
  burped: number;
  ringouts: number;
  smashed: number;
}

function agg(runs: BotRun[]): Agg {
  const a: Agg = {
    n: runs.length,
    scores: [],
    persisted: 0,
    off: 0,
    recovered: 0,
    crumbled: 0,
    burped: 0,
    ringouts: 0,
    smashed: 0,
  };
  for (const r of runs) {
    a.scores.push(r.summary.score);
    a.persisted += r.persisted;
    a.off += r.pixelsOff;
    a.recovered += r.recovered;
    a.crumbled += r.crumbled ? 1 : 0;
    a.burped += r.burped ? 1 : 0;
    a.ringouts += r.ringouts;
    a.smashed += r.summary.smashed;
  }
  a.scores.sort((x, y) => x - y);
  return a;
}

const median = (xs: number[]): number => xs[Math.floor(xs.length / 2)] ?? 0;
const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const pct = (x: number): string => `${(100 * x).toFixed(1)} %`;

function row(label: string, a: Agg): string {
  return [
    label.padEnd(10),
    String(Math.round(mean(a.scores))).padStart(6),
    String(median(a.scores)).padStart(6),
    (a.persisted / a.n).toFixed(2).padStart(7),
    (a.off / a.n).toFixed(1).padStart(6),
    pct(a.off ? a.recovered / a.off : 1).padStart(8),
    pct(a.crumbled / a.n).padStart(8),
    pct(a.burped / a.n).padStart(8),
    (a.ringouts / a.n).toFixed(2).padStart(6),
    (a.smashed / a.n).toFixed(1).padStart(6),
  ].join(" | ");
}

const HEADER = "profile    |   avg  |   med  | lost/run| px off | grab-back| crumble |  burped | rings | pops";

function play(profile: BotProfile, bodyShare = 1): { all: BotRun[]; perFamily: Map<string, BotRun[]> } {
  const perFamily = new Map<string, BotRun[]>();
  const all: BotRun[] = [];
  for (const f of familyFriends()) {
    const runs: BotRun[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(playBot(f.cfg(0x5eed0000 + i, bodyShare), profile, 7919 * i + 1));
    perFamily.set(f.family, runs);
    all.push(...runs);
  }
  return { all, perFamily };
}

print(`Pixel Life balance — ${RUNS} runs × 9 families × 3 profiles, arena ${ARENA}`);
print("");
print(HEADER);
const results = new Map<string, ReturnType<typeof play>>();
for (const p of Object.values(BOT_PROFILES)) {
  const r = play(p);
  results.set(p.name, r);
  print(row(p.name, agg(r.all)));
}
print("");
print("per family (average profile):");
print(HEADER.replace("profile   ", "family    "));
const avg = results.get("average");
if (avg) for (const [fam, runs] of avg.perFamily) print(row(fam, agg(runs)));
const medians = avg ? [...avg.perFamily.values()].map((r) => median(agg(r).scores)) : [];
const mm = mean(medians);
print("");
print(
  `family median score spread (average profile): ${medians.map((m) => `${(((m - mm) / mm) * 100).toFixed(1)}%`).join(" ")}`,
);
const body70 = play(BOT_PROFILES.average, 0.7);
const full = avg ? median(agg(avg.all).scores) : 0;
const part = median(agg(body70.all).scores);
print(
  `mass matters: average-profile median score at 70 % body = ${part} vs 100 % body = ${full} (${(((part - full) / full) * 100).toFixed(1)} %)`,
);
