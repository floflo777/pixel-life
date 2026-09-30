/** Sub-codes carried in `SimEvent.a` / `SimEvent.b` (see the event table in `sim-types.ts`). */

/** `pixelLost.b`: why a pixel was lost. */
export const LOST_TIMEOUT = 0;
/** See LOST_TIMEOUT. */
export const LOST_EDGE = 1;
/** See LOST_TIMEOUT. */
export const LOST_SNATCH = 2;
/** See LOST_TIMEOUT. */
export const LOST_SLURP = 3;
/** See LOST_TIMEOUT. */
export const LOST_GULP = 4;
/** See LOST_TIMEOUT. */
export const LOST_RINGOUT = 5;
/** See LOST_TIMEOUT. */
export const LOST_END = 6;

/** `edge.a`: ring-out phases. */
export const EDGE_FALL = 0;
/** See EDGE_FALL. */
export const EDGE_HOVER = 1;
/** See EDGE_FALL. */
export const EDGE_SAVED = 2;
/** See EDGE_FALL. */
export const EDGE_RESPAWN = 3;
/** See EDGE_FALL. */
export const EDGE_PIXELS = 4;

/** `gulp.a`: Old Gulp beats (`gulp.b` = tooth index for lit/hit). */
export const GULP_EV_RUMBLE = 0;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_BITE = 1;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_TOOTH_LIT = 2;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_TOOTH_HIT = 3;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_BURP = 4;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_INHALE = 5;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_SINK = 6;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_REGROW = 7;
/** See GULP_EV_RUMBLE. */
export const GULP_EV_EATEN = 8;

/** `trait.b`: which trait action fired (`trait.a` = familyId). */
export const TRAIT_SPLIT = 0;
/** See TRAIT_SPLIT. */
export const TRAIT_MERGE = 1;
/** See TRAIT_SPLIT. */
export const TRAIT_QUAKE = 2;
/** See TRAIT_SPLIT. */
export const TRAIT_HOOK = 3;
/** See TRAIT_SPLIT. */
export const TRAIT_TRAIL = 4;

/** `end.a`: why the run ended. */
export const END_TIME = 0;
/** See END_TIME. */
export const END_CRUMBLE = 1;

/** `hit.b`: what kind of non-lethal contact happened. */
export const HIT_LAUNCH_FIZZ = 0;
/** See HIT_LAUNCH_FIZZ. */
export const HIT_PLATE = 1;
/** See HIT_LAUNCH_FIZZ. */
export const HIT_SLURP = 2;
/** See HIT_LAUNCH_FIZZ. */
export const HIT_BUMPER = 3;
/** See HIT_LAUNCH_FIZZ. */
export const HIT_TOOTH_BOUNCE = 4;
