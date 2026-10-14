import { updated } from '$app/state';

const RELOAD_KEY = 'sable:dynamic-import-reload';
const RELOAD_WINDOW_MS = 30_000;

function isDynamicImportError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:failed to fetch|error loading) dynamically imported module|unable to preload CSS for/i.test(
      error.message
    )
  );
}

/**
 * Reloads only when the failed import comes from a build the server has
 * replaced. A failure on an unchanged build is a network problem and a reload
 * would not fix it, so the error is left to surface instead.
 */
export async function recoverStaleDynamicImport(error: unknown): Promise<boolean> {
  if (!isDynamicImportError(error)) return false;

  try {
    const now = Date.now();
    const reloadedAt = Number(sessionStorage.getItem(RELOAD_KEY));
    if (Number.isFinite(reloadedAt) && now - reloadedAt < RELOAD_WINDOW_MS) return false;
    if (!(await updated.check())) return false;

    sessionStorage.setItem(RELOAD_KEY, String(now));
    location.reload();
    return true;
  } catch {
    return false;
  }
}

export function installDynamicImportRecovery(): () => void {
  const handleRejection = (event: Event): void => {
    void recoverStaleDynamicImport((event as PromiseRejectionEvent).reason);
  };

  window.addEventListener('unhandledrejection', handleRejection);
  return () => {
    window.removeEventListener('unhandledrejection', handleRejection);
  };
}
