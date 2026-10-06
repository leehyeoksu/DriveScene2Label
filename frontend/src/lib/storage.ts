/**
 * Small, versioned localStorage helpers. Only preferences and job receipts live here —
 * never images, point clouds or result sets. Corrupt or foreign data falls back to the default.
 */
export function readStored<T>(key: string, version: number, validate: (v: unknown) => v is T, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { v?: unknown; data?: unknown };
    if (parsed?.v !== version || !validate(parsed.data)) return fallback;
    return parsed.data;
  } catch {
    return fallback;
  }
}

export function writeStored<T>(key: string, version: number, data: T): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify({ v: version, data }));
  } catch {
    // Storage full or disabled: preferences/receipts are conveniences, the app works without them.
  }
}
