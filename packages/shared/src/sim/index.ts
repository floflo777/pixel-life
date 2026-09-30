/** @pl/shared sim — the deterministic Pixel Life simulation (architecture §3). See TUNING.md for every constant. */
export { createSim, replay, hashWorld, viewWorld, summarizeWorld, SIM_VERSION } from "./sim.js";
export {
  encodeInputs,
  decodeInputs,
  validateInputs,
  inputsToBase64,
  inputsFromBase64,
  INPUT_LOG_VERSION,
} from "./codec.js";
export { World, launchSpeed, slideDistance, stopTicks } from "./world.js";
export { angleOf, sinA, cosA, angleDelta, degToAngle, powerCurve, ANGLE_STEPS } from "./fixed-math.js";
export { Rng } from "./rng.js";
export { Island } from "./arena.js";
export { TRAITS, trait, type TraitParams } from "./traits.js";
export * as SimTuning from "./tuning.js";
export * as SimEvents from "./events.js";
export { createBot, BOT_PROFILES, type BotProfile, type Bot } from "./bot.js";
