import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { cx } from "./cx.js";

/**
 * Button variants. `now` is lime and means "tap this now": at most one per screen (art bible §1.3). `paper` is the
 * default secondary, `ink` inverted, `quiet` text-like, `danger` coral for destructive or cancel-with-loss actions.
 */
export type ButtonVariant = "now" | "paper" | "ink" | "quiet" | "danger";

/** Sizing shared by buttons and link buttons. */
export interface ButtonLook {
  variant?: ButtonVariant;
  size?: "small" | "normal" | "big";
  block?: boolean;
}

function classes({ variant = "paper", size = "normal", block = false }: ButtonLook, extra?: string): string {
  return cx(
    "pl-btn",
    variant !== "paper" && `pl-btn--${variant}`,
    size !== "normal" && `pl-btn--${size}`,
    block && "pl-btn--block",
    extra,
  );
}

/** A button with a ≥ 44 px hit target and a stepped pressed state (shadow 0 + 2 px translate, no transition). */
export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  busy = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonLook & { busy?: boolean }) {
  return (
    <button
      type={type}
      className={classes(
        { ...(variant ? { variant } : {}), ...(size ? { size } : {}), ...(block ? { block } : {}) },
        className,
      )}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
      {busy && <span aria-hidden="true">…</span>}
    </button>
  );
}

/** An anchor styled as a button (for navigation, so it keeps link semantics: new tab, copy link). */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & ButtonLook) {
  return (
    <a
      className={classes(
        { ...(variant ? { variant } : {}), ...(size ? { size } : {}), ...(block ? { block } : {}) },
        className,
      )}
      {...rest}
    />
  );
}
