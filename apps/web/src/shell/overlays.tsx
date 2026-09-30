/**
 * Shell overlays: the host confirm dialog (built on the SDK's `GameMenu`, loaded on first use: focus trap, Escape,
 * labelled dialog) and the toast area.
 */
import { lazy, Suspense } from "react";
import { useServices } from "../app/services.js";
import { useStore } from "../lib/store.js";
import { Button } from "../ui/kit.js";

const GameMenu = lazy(() => import("@rarefriends/friendsdk/frame").then((m) => ({ default: m.GameMenu })));

/** Renders the pending confirmation, if any. */
export function ConfirmHost() {
  const { confirmations } = useServices();
  const c = useStore(confirmations);
  if (!c) return null;
  return (
    <div className="menu-host">
      <Suspense fallback={<div className="rf-frame-scrim" />}>
        <GameMenu
          title={c.title}
          onClose={() => c.resolve(false)}
          footer={
            <>
              <Button onClick={() => c.resolve(false)}>cancel</Button>
              <Button variant="now" onClick={() => c.resolve(true)} data-testid="confirm">
                {c.confirmLabel}
              </Button>
            </>
          }
        >
          {c.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p className="rf-frame-note">{c.note}</p>
        </GameMenu>
      </Suspense>
    </div>
  );
}

/** Transient notices; `role="status"` so screen readers hear them without stealing focus. */
export function Toasts() {
  const { toasts } = useServices();
  const list = useStore(toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <p key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </p>
      ))}
    </div>
  );
}
