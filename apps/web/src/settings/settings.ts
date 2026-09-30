/**
 * Player settings (GDD §6.9): sound, reduced motion, no flashes. Persisted in localStorage with safe defaults; the OS
 * `prefers-reduced-motion` is the default until the player chooses.
 */
import { createStore, type Store } from "../lib/store.js";
import { isRecord, readJson, writeJson } from "../lib/storage.js";

/** Persisted settings. `reducedMotion: null` = follow the OS. Volumes are 0..1. */
export interface Settings {
  v: 1;
  muted: boolean;
  master: number;
  music: number;
  sfx: number;
  reducedMotion: boolean | null;
  noFlash: boolean;
}

/** Defaults (DEFAULT_VOLUMES of @pl/audio). */
export const DEFAULT_SETTINGS: Settings = Object.freeze({
  v: 1,
  muted: false,
  master: 0.8,
  music: 0.55,
  sfx: 0.9,
  reducedMotion: null,
  noFlash: false,
});

const KEY = "pl.settings.v1";
const vol = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;

function isSettings(v: unknown): v is Settings {
  return (
    isRecord(v) &&
    v.v === 1 &&
    typeof v.muted === "boolean" &&
    vol(v.master) &&
    vol(v.music) &&
    vol(v.sfx) &&
    (v.reducedMotion === null || typeof v.reducedMotion === "boolean") &&
    typeof v.noFlash === "boolean"
  );
}

/** Whether the OS asks for reduced motion. */
export function osReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** Effective reduced-motion flag (explicit choice, else the OS). */
export function reducedMotionOf(s: Settings): boolean {
  return s.reducedMotion ?? osReducedMotion();
}

/** The settings store, loaded from storage; every change is persisted. */
export function createSettings(): Store<Settings> {
  const store = createStore<Settings>(readJson(KEY, DEFAULT_SETTINGS, isSettings));
  store.subscribe(() => writeJson(KEY, store.get()));
  return store;
}
