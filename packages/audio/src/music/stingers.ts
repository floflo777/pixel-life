/** Tempo-synced stingers: short musical phrases that start on the next beat or bar of the running theme. */
import { MAJOR_PENTATONIC, MINOR_PENTATONIC, scaleStep } from "../math";
import type { Quantize } from "./clock";
import type { NoteEvent } from "./compose";
import type { Mood, ThemeSpec } from "./themes";

/** Stinger names. */
export type StingerName = "combo" | "gulp" | "burp" | "fill" | "results" | "door";

/** Which grid each stinger waits for. */
export const STINGER_QUANTIZE: Readonly<Record<StingerName, Quantize>> = {
  combo: "beat",
  gulp: "bar",
  burp: "beat",
  fill: "beat",
  results: "bar",
  door: "beat",
};

/** All stinger names (dev page, tests). */
export const STINGER_NAMES: readonly StingerName[] = ["combo", "gulp", "burp", "fill", "results", "door"];

function ev(
  step: number,
  midi: number,
  vel: number,
  inst: NoteEvent["inst"],
  layer: NoteEvent["layer"] = "stinger",
): NoteEvent {
  return { layer, inst, step, midi, vel };
}

/**
 * Events of a stinger in the theme's key; `step` is relative to the quantized start.
 * Pure: the director schedules them on its step grid so they land in time with the music.
 */
export function stingerEvents(name: StingerName, theme: ThemeSpec, mood: Mood): NoteEvent[] {
  const pent = mood === "gulp" ? MINOR_PENTATONIC : MAJOR_PENTATONIC;
  const r = theme.root + 24;
  const at = (s: number) => r + scaleStep(pent, s);
  switch (name) {
    case "combo":
      return [0, 1, 2, 3].map((i) => ev(i, at(i + 2), 0.6 + i * 0.1, "pluck"));
    case "burp":
      return [
        ...[0, 2, 4, 6].map((s, i) => ev(s, at(i * 2), 0.8, "marimba")),
        ev(8, at(10), 0.9, "musicbox"),
        ev(8, theme.root - 12, 0.9, "bass"),
      ];
    case "gulp":
      return [
        ev(0, theme.root - 12, 1, "drone"),
        ev(0, theme.root + 12, 0.8, "pad"),
        ev(0, theme.root + 15, 0.7, "pad"),
        ev(0, theme.root + 19, 0.7, "pad"),
        ev(0, theme.root - 12, 1, "bass"),
        ev(0, 0, 1, "kick"),
      ];
    case "fill":
      return [
        ...[0, 2, 4, 6, 8, 10, 11, 12, 13, 14, 15].map((s) => ev(s, 0, 0.35 + (s / 15) * 0.6, "snare")),
        ev(0, 0, 0.9, "kick"),
        ev(8, 0, 0.9, "kick"),
      ];
    case "results":
      return [
        ev(0, theme.root + 12, 0.7, "pad"),
        ev(0, theme.root + 16, 0.6, "pad"),
        ev(0, theme.root + 19, 0.6, "pad"),
        ev(0, at(4), 0.7, "musicbox"),
        ev(4, at(2), 0.65, "musicbox"),
        ev(8, at(1), 0.6, "musicbox"),
        ev(12, at(0), 0.75, "musicbox"),
        ev(0, theme.root - 12, 0.8, "bass"),
      ];
    case "door":
      return [ev(0, at(2), 0.7, "musicbox"), ev(2, at(5), 0.75, "musicbox")];
  }
}
