/**
 * Everything three.js, behind one dynamic import: the landing HTML and "Play now" button render before the renderer
 * downloads, and pages without a stage never pay for it.
 */
import { createStage, type SharedStage as GameStage, StageUnavailableError } from "@pl/game";

export { buildPlazaScene, type PlazaScene } from "./plaza.js";
export type { GameStage };

/** Creates the shared stage on `canvas`, or returns null when WebGL2 is unavailable (the caller shows the 2D fallback). */
export function createGameStage(
  canvas: HTMLCanvasElement,
  opts: { reducedMotion: boolean; noFlashes: boolean; preserveDrawingBuffer?: boolean },
): GameStage | null {
  try {
    return createStage(canvas, opts);
  } catch (e) {
    if (e instanceof StageUnavailableError) return null;
    throw e;
  }
}
