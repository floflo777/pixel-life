import { describe, expect, it } from "vitest";
import { MAJOR_PENTATONIC, MINOR_PENTATONIC } from "../math";
import { composeBar } from "./compose";
import { stingerEvents, STINGER_NAMES } from "./stingers";
import { HUB_THEME, LAYERS, LAYER_INDEX, RUN_THEME, layerLevels } from "./themes";

describe("composeBar", () => {
  it("is deterministic per seed and bar", () => {
    for (let bar = 0; bar < 16; bar++) {
      expect(composeBar(RUN_THEME, 42, bar, 0.5, "normal")).toEqual(composeBar(RUN_THEME, 42, bar, 0.5, "normal"));
    }
  });

  it("varies with the seed", () => {
    const a = Array.from({ length: 8 }, (_, b) => composeBar(RUN_THEME, 1, b, 0.5, "normal"));
    const b = Array.from({ length: 8 }, (_, b) => composeBar(RUN_THEME, 2, b, 0.5, "normal"));
    expect(a).not.toEqual(b);
  });

  it("emits sorted, in-bar events", () => {
    for (const theme of [RUN_THEME, HUB_THEME]) {
      for (let bar = 0; bar < 8; bar++) {
        const events = composeBar(theme, 7, bar, 1, "normal");
        for (let i = 0; i < events.length; i++) {
          const e = events[i];
          expect(e?.step).toBeGreaterThanOrEqual(0);
          expect(e?.step).toBeLessThan(16);
          if (i > 0) expect(e?.step).toBeGreaterThanOrEqual(events[i - 1]?.step ?? 0);
        }
      }
    }
  });

  it("keeps the melody in the pentatonic scale of the mood", () => {
    for (const [mood, scale] of [
      ["normal", MAJOR_PENTATONIC],
      ["gulp", MINOR_PENTATONIC],
    ] as const) {
      for (let seed = 0; seed < 5; seed++) {
        for (let bar = 0; bar < 8; bar++) {
          for (const e of composeBar(RUN_THEME, seed, bar, 1, mood)) {
            if (e.layer !== "melody") continue;
            const pc = (((e.midi - RUN_THEME.root) % 12) + 12) % 12;
            expect(scale).toContain(pc);
          }
        }
      }
    }
  });

  it("doubles the ostinato at frenzy intensity", () => {
    const count = (i: number) => composeBar(RUN_THEME, 3, 0, i, "normal").filter((e) => e.layer === "ostinato").length;
    expect(count(0.5)).toBe(8);
    expect(count(0.9)).toBe(16);
  });
});

describe("layerLevels", () => {
  const out = new Float32Array(LAYERS.length);
  const level = (name: (typeof LAYERS)[number]) => out[LAYER_INDEX[name]] ?? 0;

  it("drop-in is pad only; frenzy has everything but the drone", () => {
    layerLevels(RUN_THEME, 0, "normal", out);
    expect(level("pad")).toBeGreaterThan(0);
    for (const l of ["ostinato", "bass", "hats", "kick", "melody", "drone"] as const) expect(level(l)).toBe(0);
    layerLevels(RUN_THEME, 1, "normal", out);
    for (const l of ["pad", "ostinato", "bass", "hats", "kick", "melody"] as const) expect(level(l)).toBeGreaterThan(0);
    expect(level("drone")).toBe(0);
  });

  it("gulp mood adds the drone and layers rise monotonically", () => {
    layerLevels(RUN_THEME, 0.5, "gulp", out);
    expect(level("drone")).toBeGreaterThan(0);
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      layerLevels(RUN_THEME, i / 10, "normal", out);
      const sum = out.reduce((a, b) => a + b, 0);
      expect(sum).toBeGreaterThanOrEqual(prev);
      prev = sum;
    }
  });

  it("hub keeps ambience and melody even at zero intensity", () => {
    layerLevels(HUB_THEME, 0, "normal", out);
    expect(level("ambience")).toBeGreaterThan(0);
    expect(level("melody")).toBeGreaterThan(0);
    expect(level("kick")).toBe(0);
  });
});

describe("stingers", () => {
  it("produce non-empty, non-negative-step phrases in both themes", () => {
    for (const name of STINGER_NAMES) {
      for (const theme of [RUN_THEME, HUB_THEME]) {
        const events = stingerEvents(name, theme, "normal");
        expect(events.length).toBeGreaterThan(0);
        for (const e of events) expect(e.step).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
