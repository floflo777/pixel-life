/**
 * A canvas hosting the shared three.js stage. `mount` receives the stage once the renderer module has loaded and
 * returns a cleanup. Accessibility switches (reduced motion, no flashes) follow the settings live. Without WebGL2 the
 * `fallback` is rendered instead (GDD §6.10: step down to 2D).
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useServices } from "../app/services.js";
import { useStore } from "../lib/store.js";
import { reducedMotionOf } from "../settings/settings.js";
import type { GameStage } from "./runtime.js";
import type * as StageRuntime from "./runtime.js";

type Runtime = typeof StageRuntime;

/** Props of {@link LiveStage}. */
export interface LiveStageProps {
  /** Called once with the live stage; returns a cleanup run before the stage is disposed. */
  mount: (stage: GameStage, rt: Runtime) => () => void;
  fallback: ReactNode;
  label: string;
  className?: string;
  /** Keep the drawing buffer (share-card capture). */
  capture?: boolean;
  onReady?: () => void;
}

/** Mounts a stage on a canvas for the lifetime of the component. */
export function LiveStage({ mount, fallback, label, className, capture = false, onReady }: LiveStageProps) {
  const { settings } = useServices();
  const s = useStore(settings);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<GameStage | null>(null);
  const [state, setState] = useState<"loading" | "live" | "fallback">("loading");
  const mountRef = useRef(mount);
  mountRef.current = mount;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let stage: GameStage | null = null;
    void import("./runtime.js")
      .then((rt) => {
        if (disposed || !canvas.current) return;
        const cur = settings.get();
        stage = rt.createGameStage(canvas.current, {
          reducedMotion: reducedMotionOf(cur),
          noFlashes: cur.noFlash,
          preserveDrawingBuffer: capture,
        });
        if (!stage) {
          setState("fallback");
          return;
        }
        stageRef.current = stage;
        cleanup = mountRef.current(stage, rt);
        setState("live");
        // Signal after the first rendered frame so screenshots and e2e never see an empty canvas.
        const off = stage.onFrame(() => {
          off();
          readyRef.current?.();
        });
      })
      .catch(() => !disposed && setState("fallback"));
    return () => {
      disposed = true;
      cleanup?.();
      stage?.dispose();
      stageRef.current = null;
    };
  }, [settings, capture]);

  useEffect(() => {
    stageRef.current?.setAccess({ reducedMotion: reducedMotionOf(s), noFlashes: s.noFlash });
  }, [s]);

  return (
    <div className={`live-stage ${className ?? ""}`} data-state={state}>
      <canvas ref={canvas} role="img" aria-label={label} hidden={state === "fallback"} />
      {state === "fallback" && <div className="stage-fallback">{fallback}</div>}
    </div>
  );
}
