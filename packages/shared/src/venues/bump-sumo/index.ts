/** Bump Sumo (venue id `bump-sumo`): the deterministic 4-Friend ring-out match sim. See tuning.ts for every constant. */
export { createSumo, replaySumo, hashMatch, viewMatch, summarizeMatch, statsOf, SUMO_VERSION } from "./sim.js";
export { encodeSumoInputs, decodeSumoInputs, validateSumoInputs, SUMO_LOG_VERSION } from "./codec.js";
export { SUMO_TRAITS, sumoTrait, type SumoTrait } from "./traits.js";
export {
  SumoPhase,
  SumoFighterState,
  SumoPx,
  type SumoConfig,
  type SumoFighterConfig,
  type SumoInput,
  type SumoView,
  type SumoFighterView,
  type SumoDebrisView,
  type SumoTrailView,
  type SumoEvent,
  type SumoEventType,
  type SumoSim,
  type SumoStats,
} from "./types.js";
export * as SumoTuning from "./tuning.js";
