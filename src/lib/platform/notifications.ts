import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';

import { isNativeMobile } from './os.js';
import { hostsServiceWorker } from './service-worker.js';

/** The mobile shell raises its own native notifications, so a webview
    `new Notification()` would raise a second one beside it. */
export function presentsInApp(): boolean {
  return !isTauri() && typeof Notification !== 'undefined';
}

export function deliversWebPush(): boolean {
  return hostsServiceWorker() && 'PushManager' in globalThis;
}

/** Only the mobile shell has a token distributor. */
export function deliversNativePush(): boolean {
  return isNativeMobile();
}

export type PushPlatform = 'web' | 'android' | 'ios';

export function pushPlatform(): PushPlatform {
  if (!isNativeMobile()) return 'web';
  return osType() === 'ios' ? 'ios' : 'android';
}
