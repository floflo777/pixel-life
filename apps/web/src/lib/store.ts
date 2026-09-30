import { useSyncExternalStore } from "react";

/** A minimal observable value shared between React and plain modules. */
export interface Store<T> {
  get(): T;
  /** Replaces the value (or derives it from the previous one); notifies only when it changed (`Object.is`). */
  set(next: T | ((prev: T) => T)): void;
  /** Calls `cb` after every change; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
}

/** Creates a store holding `initial`. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      for (const cb of [...subs]) cb();
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

/** Subscribes a component to a store; re-renders when the value changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
