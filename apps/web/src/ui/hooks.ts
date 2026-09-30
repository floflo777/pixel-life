/** Small React hooks shared by the kit: reduced-motion preference and a stepped wall clock. */
import { useEffect, useState, useSyncExternalStore } from "react";

const RM_QUERY = "(prefers-reduced-motion: reduce)";

function rmMedia(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(RM_QUERY)
      : null;
  } catch {
    return null;
  }
}

function subscribeRm(cb: () => void): () => void {
  const m = rmMedia();
  if (!m) return () => undefined;
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/**
 * True when the user asked for reduced motion: the OS media query, or `data-reduced-motion="true"` on `<html>` (the
 * shell's settings toggle). Components use it to skip count-ups, shimmer and halo animation.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeRm,
    () => {
      if (typeof document !== "undefined" && document.documentElement.dataset["reducedMotion"] === "true") return true;
      return rmMedia()?.matches ?? false;
    },
    () => false,
  );
}

/** The current time in ms, refreshed every `stepMs` (stepped, like every UI clock). `fixed` pins it (tests, SSR). */
export function useNow(stepMs = 1000, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) {
      setNow(fixed);
      return;
    }
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs, fixed]);
  return now;
}
