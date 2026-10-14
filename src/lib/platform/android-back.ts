import { isAndroid } from './os.js';

export type AndroidBackAction = 'back' | 'home' | 'exit';

export function androidBackAction(
  canGoBack: boolean,
  pathname: string,
  homePath: string
): AndroidBackAction {
  if (canGoBack) return 'back';
  return pathname === homePath ? 'exit' : 'home';
}

declare global {
  interface Window {
    __sableAndroidBack?: () => boolean;
  }
}

/**
 * Hands the hardware back key to the page. The shell falls back to
 * backgrounding the app when the handler returns false.
 */
export function installAndroidBack(options: {
  pathname: () => string;
  homePath: string;
  goHome: () => void;
}): () => void {
  if (!isAndroid()) return () => {};

  const handler = (): boolean => {
    const action = androidBackAction(
      'navigation' in window ? window.navigation.canGoBack : history.length > 1,
      options.pathname(),
      options.homePath
    );
    if (action === 'back') history.back();
    if (action === 'home') options.goHome();
    return action !== 'exit';
  };
  window.__sableAndroidBack = handler;
  return () => {
    if (window.__sableAndroidBack === handler) delete window.__sableAndroidBack;
  };
}
