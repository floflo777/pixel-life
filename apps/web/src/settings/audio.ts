/**
 * The shell's audio: one `@pl/audio` engine, loaded after the first user gesture (browsers require one anyway, and it
 * keeps the engine out of the landing chunk). Mute, bus volumes and reduced audio follow the settings store.
 */
import type { AudioEngine, CueName, PlayParams } from "@pl/audio";
import type { Store } from "../lib/store.js";
import { reducedMotionOf, type Settings } from "./settings.js";

/** Shell-facing audio: fire-and-forget cues, safe to call before the engine exists. */
export interface ShellAudio {
  play(cue: CueName, params?: PlayParams): void;
  /** The engine once loaded (venues share it). */
  engine(): AudioEngine | null;
  /** Loads and unlocks the engine; call from a gesture. Resolves false when audio is unavailable. */
  unlock(): Promise<boolean>;
}

/** Binds an engine to `settings`, loading it on the first pointer/key gesture on `target`. */
export function createShellAudio(settings: Store<Settings>, target: EventTarget = window): ShellAudio {
  let engine: AudioEngine | null = null;
  let loading: Promise<AudioEngine | null> | null = null;

  const apply = (e: AudioEngine): void => {
    const s = settings.get();
    e.setMuted(s.muted);
    e.setVolume("master", s.master);
    e.setVolume("music", s.music);
    e.setVolume("sfx", s.sfx);
    e.setReducedAudio(reducedMotionOf(s));
  };

  const load = (): Promise<AudioEngine | null> => {
    loading ??= import("@pl/audio")
      .then(({ AudioEngine: Engine }) => {
        const e = new Engine({ muted: settings.get().muted });
        apply(e);
        settings.subscribe(() => apply(e));
        engine = e;
        return e;
      })
      .catch(() => null);
    return loading;
  };

  const unlock = async (): Promise<boolean> => {
    const e = await load();
    return e ? e.unlock() : false;
  };

  const onGesture = (): void => {
    for (const t of ["pointerdown", "keydown"]) target.removeEventListener(t, onGesture);
    void unlock();
  };
  for (const t of ["pointerdown", "keydown"]) target.addEventListener(t, onGesture, { passive: true });

  return {
    play(cue, params) {
      engine?.play(cue, params);
    },
    engine: () => engine,
    unlock,
  };
}
