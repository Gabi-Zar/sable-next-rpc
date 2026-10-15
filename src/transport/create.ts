import { isTauri } from '@tauri-apps/api/core';

import type { Transport } from './index';
import { createElectronTransport } from './electron';
import { isElectron } from '#lib/platform/electron.js';
import { createTauriTransport } from './tauri';
import { createWebTransport, prewarmWebWorker } from './web';

export function createTransport(): Transport {
  if (isTauri()) return createTauriTransport();
  return isElectron() ? createElectronTransport() : createWebTransport();
}

export function prewarmTransport(): void {
  if (!isTauri() && !isElectron()) prewarmWebWorker();
}
