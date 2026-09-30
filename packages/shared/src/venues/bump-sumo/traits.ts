/**
 * Family traits in the ring (GDD §4 traits re-read as sumo physics, concept B table). Data only: the match asks "what is
 * my mass multiplier", "may I hover", never "am I a Colossus".
 */
import { FAMILIES } from "../../ids.js";

/** What one family changes in Bump Sumo. Defaults = no effect. */
export interface SumoTrait {
  /** One-word trait name shown on the fighter card. */
  readonly name: string;
  /** One-line rule for the start card / first trigger toast. */
  readonly rule: string;
  /** Physics mass multiplier (Colossus heavy, Hoverer/Hollow light). */
  readonly massMult: number;
  /** Charge time multiplier (Colossus winds up slower). */
  readonly chargeMult: number;
  /** Ground damping multiplier (Hoverer slides further). */
  readonly dampMult: number;
  /** Hoverer: may hover past the edge for `HOVER_TICKS` per round. */
  readonly hover: boolean;
  /** Mask: a fresh shove release parries an incoming one. */
  readonly parry: boolean;
  /** Family: standing still braces (heavier, longer pickup reach). */
  readonly brace: boolean;
  /** Skeleton: own loose pixels crawl home. */
  readonly crawl: boolean;
  /** Asymmetry: dashes hook toward the heavy side. */
  readonly hook: boolean;
  /** Colossus: strong dashes end in a stomp. */
  readonly quake: boolean;
  /** Sparkling: dashes leave a slippery trail. */
  readonly sparkTrail: boolean;
  /** Cellular: hard hits split off an extra pixel that soaks part of the knock. */
  readonly shed: boolean;
  /** Share of knocked pixels actually lost (Hollow: hits pass through). */
  readonly lossMult: number;
}

const BASE: Omit<SumoTrait, "name" | "rule"> = {
  massMult: 1,
  chargeMult: 1,
  dampMult: 1,
  hover: false,
  parry: false,
  brace: false,
  crawl: false,
  hook: false,
  quake: false,
  sparkTrail: false,
  shed: false,
  lossMult: 1,
};

/** Sumo traits indexed by familyId (FAMILIES order). */
export const SUMO_TRAITS: readonly SumoTrait[] = [
  { ...BASE, name: "reassemble", rule: "your knocked-off pixels crawl back to you", crawl: true },
  { ...BASE, name: "parry", rule: "shove right before you're hit to bounce it back", parry: true },
  { ...BASE, name: "brace", rule: "stand still to plant your feet: heavier, longer grab", brace: true },
  { ...BASE, name: "mitosis", rule: "big hits split off a pixel that soaks the knock", shed: true },
  { ...BASE, name: "hook", rule: "your shove curves toward your heavy side", hook: true },
  {
    ...BASE,
    name: "glide",
    rule: "light and slidey: hover 1 s past the edge",
    massMult: 0.8,
    dampMult: 0.6,
    hover: true,
  },
  { ...BASE, name: "quake", rule: "heavy: big shoves end in a stomp", massMult: 1.4, chargeMult: 1.25, quake: true },
  { ...BASE, name: "spark trail", rule: "your dash leaves slippery sparks", sparkTrail: true },
  { ...BASE, name: "hollow", rule: "hits pass through: lose fewer pixels, but light", massMult: 0.85, lossMult: 0.7 },
];

/** Sumo trait of `familyId` (0..8); throws `RangeError` otherwise. */
export function sumoTrait(familyId: number): SumoTrait {
  const t = SUMO_TRAITS[familyId];
  if (!t || familyId >= FAMILIES.length) throw new RangeError("familyId must be 0..8.");
  return t;
}
