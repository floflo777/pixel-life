/**
 * Bump Sumo input log: a version byte, then 4 bytes per record (tick u16 LE, then u16 LE packing dir in bits 0..11,
 * `move` in bit 12 and `charge` in bit 13). A 90 s match of busy play is a few KB.
 */
import { MATCH_MAX_TICKS } from "./tuning.js";
import type { SumoInput } from "./types.js";

/** Format version of the encoded log. */
export const SUMO_LOG_VERSION = 1;

/** Throws `RangeError` unless `inputs` are well formed and strictly tick-increasing (one record per tick at most). */
export function validateSumoInputs(inputs: readonly SumoInput[]): void {
  let last = -1;
  for (const i of inputs) {
    if (!Number.isInteger(i.t) || i.t < 0 || i.t >= MATCH_MAX_TICKS) throw new RangeError("Input tick out of range.");
    if (i.t <= last) throw new RangeError("Inputs must be strictly tick-increasing.");
    if (!Number.isInteger(i.dir) || i.dir < 0 || i.dir > 4095) throw new RangeError("Input dir must be 0..4095.");
    if ((i.move !== 0 && i.move !== 1) || (i.charge !== 0 && i.charge !== 1))
      throw new RangeError("Input flags must be 0 or 1.");
    last = i.t;
  }
}

/** Encodes a validated log (throws `RangeError` on an invalid one). */
export function encodeSumoInputs(inputs: readonly SumoInput[]): Uint8Array {
  validateSumoInputs(inputs);
  const out = new Uint8Array(1 + inputs.length * 4);
  out[0] = SUMO_LOG_VERSION;
  inputs.forEach((i, k) => {
    const o = 1 + k * 4;
    const w = i.dir | (i.move << 12) | (i.charge << 13);
    out[o] = i.t & 255;
    out[o + 1] = i.t >> 8;
    out[o + 2] = w & 255;
    out[o + 3] = w >> 8;
  });
  return out;
}

/** Decodes a log; throws `RangeError` on a wrong version, a truncated body or invalid records. */
export function decodeSumoInputs(bytes: Uint8Array): SumoInput[] {
  if (bytes.length < 1 || bytes[0] !== SUMO_LOG_VERSION) throw new RangeError("Unknown Bump Sumo log version.");
  if ((bytes.length - 1) % 4 !== 0) throw new RangeError("Truncated Bump Sumo log.");
  const out: SumoInput[] = [];
  for (let o = 1; o < bytes.length; o += 4) {
    const t = (bytes[o] ?? 0) | ((bytes[o + 1] ?? 0) << 8);
    const w = (bytes[o + 2] ?? 0) | ((bytes[o + 3] ?? 0) << 8);
    if (w >> 14 !== 0) throw new RangeError("Unknown input flag bits.");
    out.push({ t, dir: w & 4095, move: ((w >> 12) & 1) as 0 | 1, charge: ((w >> 13) & 1) as 0 | 1 });
  }
  validateSumoInputs(out);
  return out;
}
