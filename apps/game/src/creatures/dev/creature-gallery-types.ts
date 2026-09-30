import type { SharedStage } from "../../stage/stage";

declare global {
  interface Window {
    /** Set by the creature gallery once a frame is ready (read by shoot.ts). */
    __creatures?: { ready: boolean; stage: SharedStage; stats: Record<string, unknown> };
  }
}
