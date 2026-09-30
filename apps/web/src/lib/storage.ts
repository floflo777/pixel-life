/**
 * localStorage that never throws: private windows, blocked storage and quota errors fall back to defaults
 * (GDD §6.9 "try/catch, defaults on failure").
 */

/** Reads and JSON-parses `key`; returns `fallback` when missing, unreadable or rejected by `valid`. */
export function readJson<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** JSON-serialises `value` into `key`; returns false when storage is unavailable. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Removes `key`, ignoring storage errors. */
export function removeKey(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Storage unavailable: nothing to remove.
  }
}

/** True for a non-null, non-array object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
