/** Test-only helpers for the sim unit tests (not exported from the sim entry point). */
import { EMPTY_MASK, fromRows } from "../bitmap.js";
import type { FamilyId, Hex64 } from "../ids.js";
import type { SimConfig, SimInput } from "../sim-types.js";
import { World } from "./world.js";

/** A w × h solid block sprite centred in the 16×16 grid. */
export function blockMask(w: number, h: number): Hex64 {
  const rows: string[] = [];
  const x0 = Math.floor((16 - w) / 2);
  const y0 = Math.floor((16 - h) / 2);
  for (let y = 0; y < 16; y++) {
    let r = "";
    for (let x = 0; x < 16; x++) r += x >= x0 && x < x0 + w && y >= y0 && y < y0 + h ? "#" : ".";
    rows.push(r);
  }
  return fromRows(rows);
}

/** A config for a block Friend (default 8×10 = 80 px, Skeleton-free family 1 = Mask unless given). */
export function blockConfig(
  opts: Partial<{
    seed: number;
    familyId: FamilyId;
    w: number;
    h: number;
    lost: Hex64;
    gold: Hex64;
    arena: string;
  }> = {},
): SimConfig {
  const front = blockMask(opts.w ?? 8, opts.h ?? 10);
  const friend: SimConfig["friend"] = {
    front,
    lost: opts.lost ?? EMPTY_MASK,
    familyId: opts.familyId ?? 2,
    goldHeld: 0,
  };
  if (opts.gold) friend.gold = opts.gold;
  return { seed: opts.seed ?? 1, kind: "free", arena: opts.arena ?? "meadow", friend };
}

/** A world past the drop-in lock with no creature spawning yet (tick 90 < 150). */
export function readyWorld(cfg: SimConfig = blockConfig()): World {
  const w = new World(cfg);
  for (let i = 0; i < 90; i++) w.step([]);
  w.events = [];
  return w;
}

/** Steps `n` ticks (inputs on the first tick only). */
export function run(w: World, n: number, first: readonly SimInput[] = []): void {
  for (let i = 0; i < n && !w.done; i++) w.step(i === 0 ? first.map((x) => ({ ...x, t: w.tick })) : []);
}

/** A fling input stamped at the world's current tick. */
export function fling(w: World, ang: number, pow: number): SimInput {
  return { t: w.tick, k: 0, ang, pow };
}

/** Events of a given type recorded so far. */
export function eventsOf(w: World, type: string): { t: number; a?: number; b?: number }[] {
  return w.events.filter((e) => e.type === type);
}

/** Environment variable (the shared package has no Node typings; tests run in Node). */
export function env(name: string): string | undefined {
  return (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name];
}

/**
 * Whether heavy deterministic tests run their full sets. Always locally; on CI (`CI` set, as on GitHub runners, which
 * are several times slower) they run a representative subset unless `PL_FULL_TESTS=1` asks for everything.
 */
export function fullTests(): boolean {
  return env("PL_FULL_TESTS") === "1" || !env("CI");
}

/** Explicit timeout (ms) for heavy deterministic tests: well above their slowest CI runtime, so only a hang fails. */
export const HEAVY_TIMEOUT_MS = 60_000;

/** Writes a repo-relative text file from a Node test (regeneration paths only; run vitest from the repo root). */
export async function writeRepoFile(path: string, text: string): Promise<void> {
  const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
    writeFileSync(p: string, s: string): void;
  };
  fs.writeFileSync(path, text);
}

/** High-resolution clock for perf tests (never used by the sim itself). */
export function nowMs(): number {
  return (globalThis as unknown as { performance: { now(): number } }).performance.now();
}
