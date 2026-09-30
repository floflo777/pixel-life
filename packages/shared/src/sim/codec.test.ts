import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SimInput } from "../sim-types.js";
import { decodeInputs, encodeInputs, inputsFromBase64, inputsToBase64, validateInputs } from "./codec.js";

const inputArb: fc.Arbitrary<SimInput> = fc.oneof(
  fc.record({ t: fc.nat(4000), k: fc.constant(0 as const), ang: fc.nat(4095), pow: fc.nat(1023) }),
  fc.record({
    t: fc.nat(4000),
    k: fc.constant(1 as const),
    dir: fc.nat(4095),
    on: fc.constantFrom(0 as const, 1 as const),
  }),
);
const logArb = fc.array(inputArb, { maxLength: 300 }).map((xs) => [...xs].sort((a, b) => a.t - b.t));

describe("input codec", () => {
  it("round-trips any sorted log exactly (bytes and base64)", () => {
    fc.assert(
      fc.property(logArb, (log) => {
        expect(decodeInputs(encodeInputs(log))).toEqual(log);
        expect(inputsFromBase64(inputsToBase64(log))).toEqual(log);
      }),
    );
  });

  it("is compact: 60 flings in about 300 bytes (GDD §5.8 ≤ 8 KB)", () => {
    const log: SimInput[] = Array.from({ length: 60 }, (_, i) => ({
      t: 60 * i + 5,
      k: 0,
      ang: (i * 331) % 4096,
      pow: 700,
    }));
    expect(encodeInputs(log).length).toBeLessThan(310);
  });

  it("rejects malformed logs and inputs", () => {
    expect(() =>
      validateInputs([
        { t: 5, k: 0, ang: 1, pow: 1 },
        { t: 4, k: 0, ang: 1, pow: 1 },
      ]),
    ).toThrow(RangeError);
    expect(() => encodeInputs([{ t: 0, k: 0, ang: 4096, pow: 1 }])).toThrow(RangeError);
    expect(() => encodeInputs([{ t: 0, k: 0, ang: 1, pow: 1.5 }])).toThrow(RangeError);
    expect(() => encodeInputs([{ t: -1, k: 1, dir: 0, on: 1 }])).toThrow(RangeError);
    expect(() => encodeInputs([{ t: 0, k: 1, dir: 0, on: 2 as 1 }])).toThrow(RangeError);
    const ok = encodeInputs([{ t: 3, k: 0, ang: 5, pow: 6 }]);
    expect(() => decodeInputs(ok.slice(0, ok.length - 1))).toThrow(/Truncated/);
    expect(() => decodeInputs(Uint8Array.from([...ok, 0]))).toThrow(/Trailing/);
    expect(() => decodeInputs(Uint8Array.from([2, 0]))).toThrow(/version/);
    expect(() => decodeInputs(Uint8Array.from([1, 1, 1, 0xff, 0xff]))).toThrow(RangeError);
    expect(() => inputsFromBase64("abc")).toThrow(/base64/);
  });

  it("never throws anything but RangeError on random bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        try {
          decodeInputs(bytes);
        } catch (e) {
          expect(e).toBeInstanceOf(RangeError);
        }
      }),
    );
  });
});
