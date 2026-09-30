import {
  DEFAULT_GESTURES,
  GestureTracker,
  KeyAxes,
  isGameKey,
  keyAction,
  toPoint,
  type GestureConfig,
  type InputEvent,
  type InputPoint,
  type PointerKind,
  type Vec2,
} from "./input";

/** The stage's unified input: pointer, touch and keyboard as one event stream plus polled state. */
export interface PointerInput {
  /** Last known pointer position (hover included), or null before any pointer activity. */
  readonly pointer: InputPoint | null;
  /** True while the primary pointer is pressed. */
  readonly pressed: boolean;
  /** Held movement keys as a normalised screen-space axis (x right, y down). */
  axis(): Vec2;
  /** True while the key (KeyboardEvent.code) is held. */
  isKeyDown(code: string): boolean;
  /** Subscribes to normalised events; returns an unsubscribe function. */
  on(listener: (e: InputEvent) => void): () => void;
  /** Removes every DOM listener. */
  dispose(): void;
}

/**
 * Focusable controls that own their keys: Enter/Space activate them, arrows move inside them, typing edits them. The
 * stage never takes a key from one of these (#26).
 */
export const INTERACTIVE_SELECTOR =
  'button,a,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[role=button],[role=link],[role=checkbox],[role=switch],[role=menuitem],[role=tab],[role=slider],[role=textbox]';

function isElement(t: unknown): t is Element {
  return typeof t === "object" && t !== null && typeof (t as Partial<Element>).closest === "function";
}

/**
 * Whether a key event on `target` belongs to the stage in `container`. Yes when nothing specific has focus (window,
 * document, `<body>`, `<html>`) or the target is a non-interactive element inside the stage container; no when it is
 * (inside) an interactive element ({@link INTERACTIVE_SELECTOR}) or any other element outside the container, so page
 * buttons, links and fields keep their default keyboard behaviour.
 */
export function isStageKeyTarget(target: EventTarget | null, container: Element): boolean {
  if (!isElement(target)) return true;
  const doc = target.ownerDocument;
  if (target === doc.body || target === doc.documentElement) return true;
  if (target.closest(INTERACTIVE_SELECTOR)) return false;
  return container.contains(target);
}

function kindOf(t: string): PointerKind {
  return t === "touch" || t === "pen" ? t : "mouse";
}

/**
 * Binds a GestureTracker and KeyAxes to a canvas. Uses Pointer Events (touch, pen, mouse) with
 * pointer capture, and falls back to Touch Events on engines without PointerEvent. Keyboard is
 * listened for on the window, but only while the canvas's document has focus, and a key press is ignored entirely
 * (no stage event, no `preventDefault`) unless both its target and the focused element pass {@link isStageKeyTarget}
 * for `container` (default: the canvas's parent, which also holds the venue HUD).
 */
export function bindPointerInput(
  canvas: HTMLCanvasElement,
  cfg: GestureConfig = DEFAULT_GESTURES,
  win: Window = window,
  container: Element = canvas.parentElement ?? canvas,
): PointerInput {
  const tracker = new GestureTracker(cfg);
  const keys = new KeyAxes();
  const listeners = new Set<(e: InputEvent) => void>();
  let pointer: InputPoint | null = null;
  const cleanups: (() => void)[] = [];

  const emit = (events: readonly InputEvent[]): void => {
    for (const e of events) for (const l of listeners) l(e);
  };
  const local = (clientX: number, clientY: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    tracker.resize(r.width, r.height);
    pointer = toPoint(clientX - r.left, clientY - r.top, r.width, r.height);
    return [pointer.x, pointer.y];
  };
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ): void => {
    const h = fn as EventListener;
    target.addEventListener(type, h, opts);
    cleanups.push(() => target.removeEventListener(type, h, opts));
  };

  // Stop the browser from panning/zooming the page while flinging on the canvas.
  const prevTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";
  cleanups.push(() => {
    canvas.style.touchAction = prevTouchAction;
  });

  if ("PointerEvent" in win) {
    listen(canvas, "pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const [x, y] = local(e.clientX, e.clientY);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Capture can fail for synthetic events; gestures still work without it.
      }
      emit(tracker.down(e.pointerId, x, y, e.timeStamp, kindOf(e.pointerType)));
    });
    listen(canvas, "pointermove", (e) => {
      const [x, y] = local(e.clientX, e.clientY);
      emit(tracker.move(e.pointerId, x, y, e.timeStamp));
    });
    listen(canvas, "pointerup", (e) => {
      const [x, y] = local(e.clientX, e.clientY);
      emit(tracker.up(e.pointerId, x, y, e.timeStamp));
    });
    listen(canvas, "pointercancel", (e) => emit(tracker.cancel(e.pointerId)));
    listen(canvas, "lostpointercapture", (e) => emit(tracker.cancel(e.pointerId)));
  } else {
    const touches = (e: TouchEvent, fn: (t: Touch) => InputEvent[]): void => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) emit(fn(t));
    };
    const opts = { passive: false };
    listen(
      canvas,
      "touchstart",
      (e) =>
        touches(e, (t) => {
          const [x, y] = local(t.clientX, t.clientY);
          return tracker.down(t.identifier, x, y, e.timeStamp, "touch");
        }),
      opts,
    );
    listen(
      canvas,
      "touchmove",
      (e) =>
        touches(e, (t) => {
          const [x, y] = local(t.clientX, t.clientY);
          return tracker.move(t.identifier, x, y, e.timeStamp);
        }),
      opts,
    );
    listen(
      canvas,
      "touchend",
      (e) =>
        touches(e, (t) => {
          const [x, y] = local(t.clientX, t.clientY);
          return tracker.up(t.identifier, x, y, e.timeStamp);
        }),
      opts,
    );
    listen(canvas, "touchcancel", (e) => touches(e, (t) => tracker.cancel(t.identifier)), opts);
  }

  listen(win, "keydown", (e) => {
    if (!isStageKeyTarget(e.target, container) || !isStageKeyTarget(win.document.activeElement, container)) return;
    if (isGameKey(e.code)) e.preventDefault();
    if (!keys.set(e.code, true)) return;
    emit([{ type: "key", code: e.code, down: true, action: keyAction(e.code) }]);
  });
  listen(win, "keyup", (e) => {
    if (!keys.set(e.code, false)) return;
    emit([{ type: "key", code: e.code, down: false, action: keyAction(e.code) }]);
  });
  listen(win, "blur", () => {
    emit(tracker.cancel());
    emit(keys.clear().map((code) => ({ type: "key" as const, code, down: false, action: keyAction(code) })));
  });

  return {
    get pointer() {
      return pointer;
    },
    get pressed() {
      return tracker.pressed;
    },
    axis: () => keys.axis(),
    isKeyDown: (code) => keys.isDown(code),
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      for (const c of cleanups.splice(0)) c();
      listeners.clear();
    },
  };
}
