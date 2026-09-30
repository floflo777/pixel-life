/**
 * The UI kit (art bible §6): paper cards with 2 px ink borders and hard offset shadows, radius 0, Silkscreen display
 * type, lowercase mono labels. Lime is reserved for the single "act now" button on a screen (`variant="now"`).
 */
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { Link } from "../lib/router.js";

/** Button variants: `now` (lime, one per screen), `ink` (inverted), `paper` (default), `quiet` (text-like). */
export type ButtonVariant = "now" | "ink" | "paper" | "quiet";

/** A 44 px-minimum button with a stepped pressed state. */
export function Button({
  variant = "paper",
  big = false,
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; big?: boolean }) {
  const cls = ["btn", `btn-${variant}`, big ? "btn-big" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type={type} className={cls} {...rest} />;
}

/** A link styled as a button. */
export function LinkButton({
  to,
  variant = "paper",
  big = false,
  children,
  ...rest
}: {
  to: string;
  variant?: ButtonVariant;
  big?: boolean;
  children: ReactNode;
  "aria-label"?: string;
}) {
  return (
    <Link to={to} className={`btn btn-${variant}${big ? " btn-big" : ""}`} {...rest}>
      {children}
    </Link>
  );
}

/** A paper card; `inverted` flips to ink. */
export function Card({
  title,
  children,
  inverted = false,
  className,
  actions,
  as: Tag = "section",
  labelledBy,
}: {
  title?: ReactNode;
  children: ReactNode;
  inverted?: boolean;
  className?: string;
  actions?: ReactNode;
  as?: "section" | "div" | "article" | "aside";
  labelledBy?: string;
}) {
  return (
    <Tag className={`card${inverted ? " card-ink" : ""} ${className ?? ""}`} aria-labelledby={labelledBy}>
      {(title || actions) && (
        <header className="card-head">
          {title && (
            <h2 className="display" id={labelledBy}>
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** The mandatory label on every simulated RF figure (CONTRIBUTING, D-12). */
export function SimTag({ live = false }: { live?: boolean }) {
  return live ? (
    <span className="tag tag-live">live</span>
  ) : (
    <span className="tag tag-sim" title="Simulated RF: no real tokens move">
      SIMULATED
    </span>
  );
}

/** A small tag / pill. `now` = lime urgency pill. */
export function Tag({ children, tone = "paper" }: { children: ReactNode; tone?: "paper" | "ink" | "now" | "coral" }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

const SPIN = ["|", "/", "-", "\\"] as const;

/** Loading state: the ASCII spinner of GDD §6.10 (stepped, frozen under reduced motion via CSS). */
export function Loading({ label = "loading" }: { label?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % SPIN.length), 120);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="loading mono" role="status" aria-live="polite">
      <span aria-hidden="true" className="spinner">
        {SPIN[i]}
      </span>{" "}
      {label}…
    </p>
  );
}

/** Error state with a retry button (never a full-screen modal, GDD §6.10). */
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="paper">
          retry
        </Button>
      )}
    </div>
  );
}

/** A labelled value row ("missing  7 px"). */
export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label mono">{label}</span>
      <span className="stat-value">{children}</span>
    </div>
  );
}
