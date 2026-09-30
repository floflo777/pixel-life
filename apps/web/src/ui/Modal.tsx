import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button.js";
import { cx } from "./cx.js";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Props of {@link Modal} and {@link Sheet}. */
export interface ModalProps {
  open: boolean;
  title: ReactNode;
  /** Called on Esc, the close button and a backdrop click (unless `dismissible` is false). */
  onClose: () => void;
  children: ReactNode;
  /** Footer (actions). */
  footer?: ReactNode;
  /** When false, Esc and backdrop clicks do nothing (e.g. while a payment is in flight). Default true. */
  dismissible?: boolean;
  /** Accessible description id (optional). */
  describedBy?: string;
}

function Overlay({
  open,
  title,
  onClose,
  children,
  footer,
  dismissible = true,
  describedBy,
  sheet,
}: ModalProps & { sheet: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Move focus in on open and restore it on close: keyboard users never lose their place.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => before?.focus();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (dismissible) onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    // Focus trap: wrap Tab / Shift+Tab inside the dialog.
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className={cx("pl-overlay", "pl-root", sheet && "pl-overlay--sheet")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className="pl-card pl-modal"
        onKeyDown={onKeyDown}
      >
        <header className="pl-modal-head">
          <h2 id={titleId} className="pl-display pl-h2">
            {title}
          </h2>
          {dismissible && (
            <Button variant="quiet" size="small" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          )}
        </header>
        {children}
        {footer && (
          <footer className="pl-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/** A centred dialog: focus moves in, Tab is trapped, Esc closes, focus returns to the opener. */
export function Modal(props: ModalProps) {
  return <Overlay {...props} sheet={false} />;
}

/** The same dialog anchored to the bottom edge: the phone-friendly variant for confirms and pickers. */
export function Sheet(props: ModalProps) {
  return <Overlay {...props} sheet />;
}
