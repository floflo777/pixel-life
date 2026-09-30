import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.js";

/** Props of {@link Card}. */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Silkscreen heading; also labels the card region. */
  title?: ReactNode;
  /** Heading level for `title` (default 2). */
  level?: 2 | 3;
  /** Right side of the header (a badge, a link). */
  actions?: ReactNode;
  /** `paper` default, `ink` inverted (timers, marquees), `hero` 6 px shadow (modals, heroes), `flat` no shadow. */
  variant?: "paper" | "ink" | "hero" | "flat";
  as?: "section" | "article" | "div" | "aside" | "li";
}

/** A paper card: 2 px ink border, hard 4 px offset shadow, radius 0 (art bible §6). */
export function Card({
  title,
  level = 2,
  actions,
  variant = "paper",
  as: Tag = "section",
  className,
  children,
  ...rest
}: CardProps) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <Tag className={cx("pl-card", variant !== "paper" && `pl-card--${variant}`, className)} {...rest}>
      {(title !== undefined || actions !== undefined) && (
        <header className="pl-card-head">
          {title !== undefined && <H className={cx("pl-display", level === 2 ? "pl-h2" : "pl-h3")}>{title}</H>}
          {actions}
        </header>
      )}
      {children as ReactNode}
    </Tag>
  );
}
