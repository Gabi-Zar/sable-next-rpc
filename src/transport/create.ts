import { isTauri } from '@tauri-apps/api/core';

import type { Transport } from './index';
import { createElectronTransport } from './electron';
import { isElectron } from '#lib/platform/electron.js';
import { createTauriTransport } from './tauri';
import { createWebTransport, prewarmWebWorker } from './web';
import { createWsTransport } from './ws';

export function createTransport(): Transport {
  if (isTauri()) return createTauriTransport();
  if (isElectron()) return createElectronTransport();
  return import.meta.env.VITE_SABLE_SERVER_URL
    ? createWsTransport({ url: import.meta.env.VITE_SABLE_SERVER_URL })
    : createWebTransport();
}

export function prewarmTransport(): void {
  if (!isTauri() && !isElectron() && !import.meta.env.VITE_SABLE_SERVER_URL) {
    prewarmWebWorker();
  }
}
