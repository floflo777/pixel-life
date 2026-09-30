/**
 * What this browser has already been taught: whether the first-visit cards were seen and which coachmarks are done.
 * Stored in localStorage through the shell's never-throwing helpers, so a private window simply shows the intro again.
 */
import { isRecord, readJson, writeJson } from "../lib/storage.js";

/** localStorage key (versioned so a copy rewrite can re-show the intro by bumping it). */
export const ONBOARDING_KEY = "pl.onboarding.v1";

/** Persisted onboarding progress. */
export interface OnboardingProgress {
  /** The first-visit cards were finished or skipped. */
  introSeen: boolean;
  /** Coachmark ids the player has completed (did the action, not just saw the hint). */
  coachDone: string[];
}

const EMPTY: OnboardingProgress = { introSeen: false, coachDone: [] };

function isProgress(v: unknown): v is OnboardingProgress {
  return (
    isRecord(v) &&
    typeof v["introSeen"] === "boolean" &&
    Array.isArray(v["coachDone"]) &&
    v["coachDone"].every((x) => typeof x === "string")
  );
}

/** Reads the stored progress; a missing or malformed value reads as "nothing seen yet". */
export function readProgress(): OnboardingProgress {
  const p = readJson(ONBOARDING_KEY, EMPTY, isProgress);
  return { introSeen: p.introSeen, coachDone: [...p.coachDone] };
}

/** Merges `patch` into the stored progress and returns the result (still returned when storage is unavailable). */
export function writeProgress(patch: Partial<OnboardingProgress>): OnboardingProgress {
  const next = { ...readProgress(), ...patch };
  writeJson(ONBOARDING_KEY, next);
  return next;
}

/** True when the first-visit cards should open (never seen on this browser). */
export function shouldShowIntro(): boolean {
  return !readProgress().introSeen;
}

/** Records that the first-visit cards were finished or skipped. */
export function markIntroSeen(): void {
  writeProgress({ introSeen: true });
}

/** Forgets everything, so the intro and coachmarks show again ("replay tutorial" in settings, tests). */
export function resetOnboarding(): void {
  writeJson(ONBOARDING_KEY, EMPTY);
}
