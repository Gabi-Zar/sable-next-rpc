export const NOTIFY_ONCE_WINDOW_MS = 5 * 60_000;

export function alertCooling(alertedAt: number | undefined, now: number): boolean {
  return alertedAt !== undefined && now >= alertedAt && now - alertedAt < NOTIFY_ONCE_WINDOW_MS;
}
