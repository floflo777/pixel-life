/**
 * Bits and stamps (GDD §5.7, tokenomics §7 via `BITS`). The server has no Bits ledger yet, so the shell keeps an
 * honest local tally per player (guest or Friend) with the shared earning rules and daily caps, and labels it "on this
 * device". Bits never convert to RF (D-06).
 */
import { BITS, capBits, runBits } from "@pl/shared";
import { utcDay } from "../lib/format.js";
import { createStore, type Store } from "../lib/store.js";
import { isRecord, readJson, writeJson } from "../lib/storage.js";

/** Stamps the shell can award locally (the stamp book, GDD §12.5). */
export const STAMPS = {
  "first-run": { name: "First fling", hint: "finish a run" },
  flawless: { name: "Flawless", hint: "finish a run without losing a pixel" },
  "score-1000": { name: "Four digits", hint: "score 1 000 in one run" },
  "ten-runs": { name: "Regular", hint: "finish 10 runs" },
  mender: { name: "Mender", hint: "mend a stranger's Friend" },
  "whole-again": { name: "Whole again", hint: "regrow your Friend to whole" },
} as const;
/** A stamp id. */
export type StampId = keyof typeof STAMPS;

/** One player's local progress. */
export interface Progress {
  bits: number;
  day: string;
  earnedToday: number;
  runs: number;
  best: number;
  stamps: StampId[];
}

const KEY = "pl.progress.v1";
const EMPTY: Progress = { bits: 0, day: "", earnedToday: 0, runs: 0, best: 0, stamps: [] };

function isProgress(v: unknown): v is Progress {
  return (
    isRecord(v) &&
    Number.isSafeInteger(v.bits) &&
    typeof v.day === "string" &&
    Number.isSafeInteger(v.earnedToday) &&
    Number.isSafeInteger(v.runs) &&
    typeof v.best === "number" &&
    Array.isArray(v.stamps) &&
    v.stamps.every((s) => typeof s === "string" && s in STAMPS)
  );
}
function isBook(v: unknown): v is Record<string, Progress> {
  return isRecord(v) && Object.values(v).every(isProgress);
}

/** What a finished run earned. */
export interface RunReward {
  bits: number;
  firstRunOfDay: boolean;
  newStamps: StampId[];
}

/** Local progress for every player on this device. */
export interface ProgressBook {
  readonly store: Store<Record<string, Progress>>;
  get(player: string): Progress;
  /** Credits a finished run: `runBits` then `capBits` against today's earnings; awards run stamps. */
  recordRun(player: string, run: { score: number; lost: number }, now: number): RunReward;
  /** Awards a stamp once; returns true if it was new. */
  stamp(player: string, id: StampId): boolean;
}

/** Creates the progress book backed by localStorage. */
export function createProgressBook(): ProgressBook {
  const store = createStore<Record<string, Progress>>(readJson(KEY, {}, isBook));
  const put = (player: string, p: Progress): void => {
    store.set((b) => ({ ...b, [player]: p }));
    writeJson(KEY, store.get());
  };
  const get = (player: string): Progress => store.get()[player] ?? EMPTY;
  return {
    store,
    get,
    recordRun(player, run, now) {
      const day = utcDay(now);
      const prev = get(player);
      const earnedToday = prev.day === day ? prev.earnedToday : 0;
      const firstRunOfDay = prev.day !== day;
      // Skill bonus: fewer pixels lost earns more (0..runSkillMax).
      const skill = Math.max(0, BITS.runSkillMax - 2 * run.lost);
      const bits = capBits(earnedToday, runBits(skill, firstRunOfDay));
      const stamps = new Set(prev.stamps);
      const runs = prev.runs + 1;
      const award: StampId[] = ["first-run"];
      if (run.lost === 0) award.push("flawless");
      if (run.score >= 1000) award.push("score-1000");
      if (runs >= 10) award.push("ten-runs");
      const newStamps = award.filter((s) => !stamps.has(s));
      for (const s of newStamps) stamps.add(s);
      put(player, {
        bits: prev.bits + bits,
        day,
        earnedToday: earnedToday + bits,
        runs,
        best: Math.max(prev.best, run.score),
        stamps: [...stamps],
      });
      return { bits, firstRunOfDay, newStamps };
    },
    stamp(player, id) {
      const prev = get(player);
      if (prev.stamps.includes(id)) return false;
      put(player, { ...prev, stamps: [...prev.stamps, id] });
      return true;
    },
  };
}
