import {
  currentDeepLinks,
  deliversDeepLinks,
  subscribeDeepLinks,
} from '#lib/platform/deep-links.js';
import { matrixLinkPath } from './permalink';

export function watchMatrixLinks(open: (path: string) => void): () => void {
  if (!deliversDeepLinks()) return () => {};
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const receive = (urls: string[]): void => {
    if (stopped) return;
    for (const url of urls) {
      const path = matrixLinkPath(url);
      if (path !== null) open(path);
    }
  };
  void subscribeDeepLinks(receive)
    .then(async (stop) => {
      if (stopped) {
        stop();
        return;
      }
      unsubscribe = stop;
      receive(await currentDeepLinks((url) => matrixLinkPath(url) !== null));
    })
    .catch((error: unknown) => {
      console.warn('[sable deep-link] subscribing failed', error);
    });
  return () => {
    stopped = true;
    unsubscribe?.();
  };
}
