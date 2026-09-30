import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

/** State of an async read. */
export type AsyncState<T> =
  | { status: "loading"; data: T | undefined }
  | { status: "ok"; data: T }
  | { status: "error"; error: unknown; data: T | undefined };

/**
 * Runs `fn` on mount and whenever `deps` change; `retry()` runs it again. Stale answers (from an older run or after
 * unmount) are dropped. Previous data is kept while reloading so screens do not flash empty.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> & { retry(): void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading", data: undefined });
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const id = ++run.current;
    setState((s) => ({ status: "loading", data: s.data }));
    fnRef.current().then(
      (data) => id === run.current && setState({ status: "ok", data }),
      (error: unknown) => id === run.current && setState((s) => ({ status: "error", error, data: s.data })),
    );
    return () => {
      run.current++;
    };
    // Callers pass the dependencies of `fn` explicitly (like useEffect).
  }, [...deps, nonce]);
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, retry };
}

/** Re-renders every `ms` and returns the current time (heal timers, countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
