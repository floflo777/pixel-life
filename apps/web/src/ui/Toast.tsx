import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button.js";
import { cx } from "./cx.js";

/** A transient message. `bad` toasts are announced assertively; the rest politely. */
export interface ToastItem {
  id: number;
  text: string;
  tone?: "info" | "good" | "bad";
}

/** Renders toasts in a fixed live region above the bottom HUD (the SDK corners stay clear). */
export function ToastRegion({ toasts, onDismiss }: { toasts: readonly ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pl-toasts pl-root" aria-live="polite" role="status">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx("pl-card", "pl-toast", t.tone && t.tone !== "info" && `pl-toast--${t.tone}`)}
          role={t.tone === "bad" ? "alert" : undefined}
        >
          <span>{t.text}</span>
          <Button variant="quiet" size="small" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            ✕
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Local toast queue: keeps the last 3, auto-dismisses after `ttlMs` (default 5 s). */
export function useToasts(ttlMs = 5000): {
  toasts: readonly ToastItem[];
  push: (text: string, tone?: ToastItem["tone"]) => void;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (text: string, tone: ToastItem["tone"] = "info") => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-2), { id, text, tone }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, ttlMs);
      timers.current.add(timer);
    },
    [dismiss, ttlMs],
  );
  useEffect(() => {
    const set = timers.current;
    return () => set.forEach(clearTimeout);
  }, []);
  return { toasts, push, dismiss };
}
