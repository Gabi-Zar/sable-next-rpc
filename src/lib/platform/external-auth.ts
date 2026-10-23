import { invoke, isTauri } from '@tauri-apps/api/core';

import { isElectron } from './electron';

export interface ExternalAuthWindow {
  navigate: (url: string) => Promise<void>;
  close: () => void;
}

export function openExternalAuthWindow(name: string): ExternalAuthWindow | null {
  if (isTauri() || isElectron()) {
    return {
      navigate: openExternalAuthUrl,
      close: () => {},
    };
  }

  const popup = window.open('about:blank', name, 'popup,width=520,height=720');
  if (!popup) return null;

  return {
    navigate: (url) => {
      popup.location.replace(url);

      return Promise.resolve();
    },
    close: () => {
      popup.close();
    },
  };
}

export async function openExternalAuthUrl(url: string): Promise<void> {
  if (isTauri()) {
    const { platform } = await import('@tauri-apps/plugin-os');
    await invoke(platform() === 'ios' ? 'open_in_app_auth_url' : 'open_external_url', { url });

    return;
  }

  window.open(url, '_blank', 'noopener');
}

export async function startInAppAuthSession(
  authUrl: string,
  callbackUri: string
): Promise<string | null> {
  if (!isTauri()) return null;
  const { platform } = await import('@tauri-apps/plugin-os');
  if (platform() !== 'ios') return null;

  return invoke<string>('plugin:auth-session|start', {
    authUrl,
    callbackUrlScheme: new URL(callbackUri).protocol.slice(0, -1),
    ephemeral: false,
  });
}
