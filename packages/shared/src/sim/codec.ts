/**
 * Compact binary input log (architecture §4.6, GDD §5.8 "≤ 8 KB per run"). Layout, version 1:
 *   u8 version (=1) · varint count · per input: varint((Δt << 1) | k) then
 *   k = 0 (fling): 3 bytes little-endian of (ang << 10 | pow)   k = 1 (steer): 2 bytes little-endian of (dir << 1 | on)
 * Δt is the tick delta from the previous input (first input: from tick 0), so logs must be sorted by tick.
 * A typical 60 s run with ~60 flings is ≈ 300 bytes.
 */
import type { SimInput } from "../sim-types.js";

/** Current input log format version. */
export const INPUT_LOG_VERSION = 1;
/** Largest tick an input log may carry (well above a run; bounds decoder work). */
export const MAX_INPUT_TICK = 1 << 20;
/** Largest number of inputs in one log (bounds decoder work and memory). */
export const MAX_INPUTS = 65536;

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

/** Throws `RangeError` unless `inputs` is a well-formed, tick-sorted input log. */
export function validateInputs(inputs: readonly SimInput[]): void {
  if (inputs.length > MAX_INPUTS) throw new RangeError("Too many inputs.");
  let prev = 0;
  for (const i of inputs) {
    if (!isInt(i.t, prev, MAX_INPUT_TICK)) throw new RangeError("Input ticks must be sorted non-negative integers.");
    prev = i.t;
    if (i.k === 0) {
      if (!isInt(i.ang, 0, 4095) || !isInt(i.pow, 0, 1023))
        throw new RangeError("Fling needs ang 0..4095, pow 0..1023.");
    } else if (i.k === 1) {
      if (!isInt(i.dir, 0, 4095) || (i.on !== 0 && i.on !== 1))
        throw new RangeError("Steer needs dir 0..4095, on 0|1.");
    } else {
      throw new RangeError("Unknown input kind.");
    }
  }
}

function pushVarint(out: number[], v: number): void {
  let x = v;
  while (x >= 0x80) {
    out.push((x % 0x80) | 0x80);
    x = Math.floor(x / 0x80);
  }
  out.push(x);
}

/** Encodes a tick-sorted input log; throws `RangeError` on malformed inputs. `decodeInputs(encodeInputs(x))` equals x. */
export function encodeInputs(inputs: readonly SimInput[]): Uint8Array {
  validateInputs(inputs);
  const out: number[] = [INPUT_LOG_VERSION];
  pushVarint(out, inputs.length);
  let prev = 0;
  for (const i of inputs) {
    pushVarint(out, (i.t - prev) * 2 + i.k);
    prev = i.t;
    if (i.k === 0) {
      const v = i.ang * 1024 + i.pow;
      out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff);
    } else {
      const v = i.dir * 2 + i.on;
      out.push(v & 0xff, (v >> 8) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Decodes a log produced by `encodeInputs`; throws `RangeError` on any malformed, truncated or oversized log. */
export function decodeInputs(bytes: Uint8Array): SimInput[] {
  let p = 0;
  const byte = (): number => {
    if (p >= bytes.length) throw new RangeError("Truncated input log.");
    return bytes[p++] ?? 0;
  };
  const varint = (): number => {
    let v = 0;
    let mul = 1;
    for (let n = 0; n < 5; n++) {
      const b = byte();
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 0x80;
    }
    throw new RangeError("Varint too long.");
  };
  if (byte() !== INPUT_LOG_VERSION) throw new RangeError("Unsupported input log version.");
  const count = varint();
  if (count > MAX_INPUTS) throw new RangeError("Too many inputs.");
  const out: SimInput[] = [];
  let t = 0;
  for (let n = 0; n < count; n++) {
    const head = varint();
    const k = head % 2;
    t += (head - k) / 2;
    if (t > MAX_INPUT_TICK) throw new RangeError("Input tick out of range.");
    if (k === 0) {
      const v = byte() | (byte() << 8) | (byte() << 16);
      if (v >= 1 << 22) throw new RangeError("Malformed fling.");
      out.push({ t, k: 0, ang: v >> 10, pow: v & 1023 });
    } else {
      const v = byte() | (byte() << 8);
      if (v >= 1 << 13) throw new RangeError("Malformed steer.");
      out.push({ t, k: 1, dir: v >> 1, on: (v & 1) === 1 ? 1 : 0 });
    }
  }
  if (p !== bytes.length) throw new RangeError("Trailing bytes in input log.");
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 (RFC 4648, padded) of an encoded log: the `POST /api/runs` body field. No Buffer/btoa needed. */
export function inputsToBase64(inputs: readonly SimInput[]): string {
  const b = encodeInputs(inputs);
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = ((b[i] ?? 0) << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    s += i + 1 < b.length ? B64.charAt((n >> 6) & 63) : "=";
    s += i + 2 < b.length ? B64.charAt(n & 63) : "=";
  }
  return s;
}

/** Inverse of `inputsToBase64`; throws `RangeError` on malformed base64 or a malformed log. */
export function inputsFromBase64(b64: string): SimInput[] {
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new RangeError("Malformed base64.");
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((b64.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < b64.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const c = b64.charAt(i + k);
      n = (n << 6) | (c === "=" ? 0 : B64.indexOf(c));
    }
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return decodeInputs(out);
}
