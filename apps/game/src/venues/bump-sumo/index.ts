/**
 * Bump Sumo (venue id `bump-sumo`): a 4-Friend ring-out party game on the shared stage, driven by the deterministic
 * `createSumo` sim from `@pl/shared`. The shell builds it with the loaner pool:
 * `createBumpSumoVenue({ rivals: () => loadLoaners().then((l) => l.map((f) => f.appearance)) })`.
 */
export {
  createBumpSumoVenue,
  MANIFEST as BUMP_SUMO_MANIFEST,
  VENUE_ID as BUMP_SUMO_ID,
  type BumpSumoInstance,
  type BumpSumoOptions,
  type BumpSumoDebug,
} from "./venue";
export { pickRivals, buildSumoResults, type SumoResults } from "./format";
