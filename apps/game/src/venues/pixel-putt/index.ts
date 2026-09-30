/**
 * Pixel Putt (venue id `pixel-putt`): scarless floating mini-golf. The shell builds it with `createPixelPuttVenue()`;
 * the deterministic sim is `PixelPutt` in `@pl/shared`.
 */
export {
  createPixelPuttVenue,
  PIXEL_PUTT_ID,
  PIXEL_PUTT_MANIFEST,
  type PixelPuttDebug,
  type PixelPuttInstance,
  type PixelPuttOptions,
} from "./venue";
export { cuesFor, formatToPar, PUTT_RULE, roundHeadline, scoreName, scoreTone, type PuttTone } from "./format";
