/**
 * Chat-lite text tables (GDD §11.3–11.4). The wire only carries ids (`@pl/shared` EMOTES / QUICK_CHAT_PHRASES), so
 * this table is the single place the words live: no free text, nothing to moderate.
 */
import { EMOTES, QUICK_CHAT_PHRASES, type EmoteName } from "@pl/shared";

/** The 16 quick-chat phrases, indexed by phrase id. Lowercase: bubbles are Silkscreen, which reads caps anyway. */
export const QUICK_CHAT_TEXT: readonly string[] = [
  "hi!",
  "gg",
  "nice combo",
  "help me mend?",
  "thanks for the stitch!",
  "daily?",
  "follow me",
  "look!",
  "one more run",
  "scars heal",
  "love your halo",
  "wanna race?",
  "yes!",
  "no thanks",
  "brb",
  "bye!",
];

/** One short glyph or word per emote for the bubble above the head (art bible §4.1: one glyph or word). */
export const EMOTE_GLYPH: Readonly<Record<EmoteName, string>> = {
  wave: "hi",
  hop: "!",
  spin: "@",
  heart: "♥",
  "pixel-burst": "✦",
  sit: "zz",
  flex: "flex",
  stomp: "dosukoi",
};

/** Emotes unlocked at start (GDD §11.4: 4 of 8). */
export const STARTER_EMOTES: readonly EmoteName[] = ["wave", "heart", "hop", "pixel-burst"];

/** Emote cooldown (GDD §11.4). */
export const EMOTE_COOLDOWN_MS = 1500;

/** Phrase text for an id, or null for an id outside the table (a newer server; never render raw numbers). */
export function phraseText(id: number): string | null {
  return Number.isInteger(id) && id >= 0 && id < QUICK_CHAT_TEXT.length ? (QUICK_CHAT_TEXT[id] ?? null) : null;
}

/** Emote name for a wire id, or null when unknown. */
export function emoteName(id: number): EmoteName | null {
  return Number.isInteger(id) && id >= 0 && id < EMOTES.length ? (EMOTES[id] ?? null) : null;
}

/** Wire id of an emote. */
export function emoteId(name: EmoteName): number {
  return EMOTES.indexOf(name);
}

// Keep the table in lockstep with the protocol constant: a mismatch is a build-time bug, not a runtime surprise.
if (QUICK_CHAT_TEXT.length !== QUICK_CHAT_PHRASES) throw new Error("QUICK_CHAT_TEXT must match QUICK_CHAT_PHRASES");
