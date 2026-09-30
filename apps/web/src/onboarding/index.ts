/**
 * Onboarding + economy explainer: the public API the shell, the venue host and the pages mount.
 *
 * - `FirstVisit`: three illustrated cards on first visit, then "Play now" (skippable, once per browser).
 * - `Coachmarks` + `createCoach` / `emitCoachEvent`: first-run hints driven by named game events.
 * - `RfFlowExplainer`: "where your RF goes", full (Economy page) or locked to one payment (confirm dialogs).
 * - `WhyRealEconomy`: the judges' one-screen summary.
 */
import "./onboarding.css";

export {
  bindCoachToWindow,
  type Coach,
  COACH_DOM_EVENT,
  COACH_EVENTS,
  type CoachEventName,
  COACHMARKS,
  type CoachmarkDef,
  coachReduce,
  type CoachState,
  createCoach,
  emitCoachEvent,
} from "./coach.js";
export { Coachmarks, type CoachmarksProps } from "./Coachmarks.js";
export { FirstVisit, type FirstVisitProps } from "./FirstVisit.js";
export {
  FLOW_KINDS,
  type FlowInput,
  type FlowKind,
  flowParts,
  type FlowLeg,
  rfFlow,
  type RfFlow,
  seedOdds,
} from "./flows.js";
export { IntroCards, type IntroCardsProps } from "./IntroCards.js";
export { markIntroSeen, ONBOARDING_KEY, readProgress, resetOnboarding, shouldShowIntro } from "./progress.js";
export { RfFlowExplainer, type RfFlowExplainerProps } from "./RfFlowExplainer.js";
export { CONTRACTS_README_URL, economyClaims, WhyRealEconomy, type WhyRealEconomyProps } from "./WhyRealEconomy.js";
