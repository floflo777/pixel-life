import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

/** One tab. */
export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

/** Props of {@link Tabs}. */
export interface TabsProps<T extends string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** The active panel's content. */
  children?: ReactNode;
}

/**
 * WAI-ARIA tabs with a roving tabindex: ←/→ move and activate, Home/End jump. The single panel is labelled by the
 * active tab, so callers render only the selected content.
 */
export function Tabs<T extends string>({ tabs, value, onChange, label, children }: TabsProps<T>) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );

  const go = (i: number): void => {
    const n = tabs.length;
    const j = ((i % n) + n) % n;
    const t = tabs[j];
    if (!t) return;
    onChange(t.id);
    refs.current[j]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "ArrowRight") go(idx + 1);
    else if (e.key === "ArrowLeft") go(idx - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(tabs.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className="pl-tabs" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={t.id === value}
            aria-controls={`${base}-panel`}
            tabIndex={t.id === value ? 0 : -1}
            className="pl-tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {children !== undefined && (
        <div
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${value}`}
          tabIndex={0}
          style={{ paddingTop: 16 }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
