/**
 * Loose Pixels (venue id `pixel-life`): the flagship fling arcade as a `NativeVenue` on the shared stage.
 * The shell builds it with the real sim: `createLoosePixelsVenue({ sim: { name, createSim, encodeInputs } })`.
 */
export { createLoosePixelsVenue, MANIFEST, VENUE_ID, type LoosePixelsInstance, type LoosePixelsOptions } from "./venue";
export { FAKE_SIM } from "./fake-sim";
export { placeholderCreature, type CreatureFactory, type CreatureVisual } from "./scene";
export type { SimModule, FullSimView } from "./sim-view";
export type { VenueAudioExt, VenueMusic, CueParams } from "./audio";
export { renderShareCard } from "./share-card";
export { buildResults, type ResultsModel, type ShareCardData } from "./results";
