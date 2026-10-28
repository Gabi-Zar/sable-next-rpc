import {
  bindServerNotificationIdentity,
  boundServerIdentity,
} from '#lib/notifications/room-names.js';

if (import.meta.env.VITE_SABLE_SERVER_URL && 'document' in globalThis) {
  await bindServerNotificationIdentity().catch(() => {});
}

function optionalStorage(): Storage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

export function scopedKey(key: string): string | null {
  if (!import.meta.env.VITE_SABLE_SERVER_URL) return key;
  const identity = boundServerIdentity();
  return identity === null ? null : `sable.server-user.${identity}.${key}`;
}

export function readJson<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  try {
    const raw = readText(key);
    return raw === null ? fallback : parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function readText(key: string): string | null {
  try {
    const scoped = scopedKey(key);
    if (scoped === null) return null;
    const storage = optionalStorage();
    const current = storage?.getItem(scoped) ?? null;
    if (
      current !== null ||
      !import.meta.env.VITE_SABLE_SERVER_URL ||
      boundServerIdentity() !== 'legacy'
    )
      return current;
    const previous = storage?.getItem(key) ?? null;
    if (previous !== null) storage?.setItem(scoped, previous);
    return previous;
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string): void {
  try {
    const scoped = scopedKey(key);
    if (scoped !== null) optionalStorage()?.setItem(scoped, value);
  } catch {
    // Preferences are optional; session credentials use the core store.
  }
}

export function removeLocalValue(key: string): void {
  try {
    const scoped = scopedKey(key);
    if (scoped !== null) {
      const storage = optionalStorage();
      storage?.removeItem(scoped);
      if (import.meta.env.VITE_SABLE_SERVER_URL && boundServerIdentity() === 'legacy')
        storage?.removeItem(key);
    }
  } catch {
    // Ignore unavailable preference storage.
  }
}

export function writeJson(key: string, value: unknown, failure?: string): void {
  try {
    const scoped = scopedKey(key);
    if (scoped !== null) optionalStorage()?.setItem(scoped, JSON.stringify(value));
  } catch (error) {
    if (failure !== undefined) console.debug(failure, error);
  }
}
