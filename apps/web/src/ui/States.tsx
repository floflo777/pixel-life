import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { Button } from "./Button.js";
import { cx } from "./cx.js";

/** Remote data as a page sees it: loading, failed (with a user-facing sentence) or ready. */
export type Remote<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

/** Builders for {@link Remote} values (handy for wiring and tests). */
export const remote = Object.freeze({
  loading: <T,>(): Remote<T> => ({ status: "loading" }),
  error: <T,>(message: string): Remote<T> => ({ status: "error", message }),
  ready: <T,>(data: T): Remote<T> => ({ status: "ready", data }),
});

/** An empty list or nothing-to-do state: a glyph, a sentence and at most one action. */
export function EmptyState({
  glyph = "·",
  title,
  children,
  action,
}: {
  glyph?: string;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="pl-state">
      <span className="pl-state-glyph" aria-hidden="true">
        {glyph}
      </span>
      <p className="pl-display pl-h3">{title}</p>
      {children && (
        <p className="pl-sub" style={{ margin: 0 }}>
          {children}
        </p>
      )}
      {action}
    </div>
  );
}

/** A failure with its reason and a retry (GDD §6.10: inline, never a full-screen modal). */
export function ErrorState({
  message,
  onRetry,
  title = "that didn't work",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="pl-state pl-state--error" role="alert">
      <span className="pl-state-glyph" aria-hidden="true">
        !
      </span>
      <p className="pl-display pl-h3">{title}</p>
      <p style={{ margin: 0 }}>{message}</p>
      {onRetry && <Button onClick={onRetry}>retry</Button>}
    </div>
  );
}

/** A placeholder block with a stepped shimmer (static under reduced motion). Hidden from assistive tech. */
export function Skeleton({
  width = "100%",
  height = 16,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return <span aria-hidden="true" className={cx("pl-skeleton", className)} style={{ width, height, ...style }} />;
}

const SPIN = ["|", "/", "-", "\\"] as const;

/**
 * Inline loading line: the stepped ASCII spinner of GDD §6.10 and a label. The spinner freezes under reduced motion
 * (the glyph is hidden from assistive tech; the label is announced politely).
 */
export function Loading({ label = "loading" }: { label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SPIN.length), 120);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="pl-loading pl-mono" role="status" aria-live="polite">
      <span aria-hidden="true" className="pl-spinner">
        {SPIN[i]}
      </span>{" "}
      {label}…
    </p>
  );
}

/** A labelled value in a stat row ("score  1 240"). */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pl-stat">
      <span className="pl-label">{label}</span>
      <span className="pl-stat-value">{children}</span>
    </div>
  );
}

/** A labelled loading region made of skeleton lines. */
export function LoadingBlock({ label = "loading", lines = 3 }: { label?: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="pl-stack">
      <span className="pl-sr-only">{label}…</span>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={`${90 - i * 15}%`} />
      ))}
    </div>
  );
}

/** Renders a {@link Remote}: skeleton while loading, {@link ErrorState} with retry on failure, `children(data)` when ready. */
export function RemoteView<T>({
  value,
  onRetry,
  loading,
  children,
}: {
  value: Remote<T>;
  onRetry?: () => void;
  loading?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (value.status === "loading") return <>{loading ?? <LoadingBlock />}</>;
  if (value.status === "error") return <ErrorState message={value.message} {...(onRetry ? { onRetry } : {})} />;
  return <>{children(value.data)}</>;
}
