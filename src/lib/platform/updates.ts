import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';
import parseVersion from 'semver/functions/parse.js';

import { SABLE_UPDATE_MANIFEST_URL } from '#lib/config/links.js';

import { electronBridge } from './electron.js';

export interface AvailableUpdate {
  version: string;
  notes: string | undefined;
  /** Downloads and stages the update; `relaunchApp` is what applies it. */
  install: (onProgress: (percent: number) => void) => Promise<void>;
}

type UpdateListener = (update: AvailableUpdate) => void;
const listeners = new Set<UpdateListener>();

export function subscribeToUpdates(listener: UpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function supportsAutoUpdate(): boolean {
  return updatePlatform() === 'desktop' && window.__SABLE_AUTO_UPDATE__ !== false;
}

export function updatePlatform(): 'desktop' | 'mobile' | 'web' {
  if (electronBridge()) return 'desktop';
  if (!isTauri()) return 'web';
  const os = osType();
  return os === 'android' || os === 'ios' ? 'mobile' : 'desktop';
}

function isNewerVersion(candidate: string, current: string): boolean {
  const latest = parseVersion(candidate);
  const installed = parseVersion(current);
  return latest !== null && installed !== null && latest.compare(installed) > 0;
}

export async function checkForMobileUpdate(): Promise<boolean> {
  const current = import.meta.env.VITE_APP_VERSION;
  if (!current || current === 'dev') return false;

  const response = await fetch(SABLE_UPDATE_MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Update manifest request failed: ${response.status}`);
  const manifest: unknown = await response.json();
  const latest =
    typeof manifest === 'object' && manifest !== null && 'version' in manifest
      ? manifest.version
      : undefined;
  return typeof latest === 'string' && isNewerVersion(latest, current);
}
let handle: { close: () => Promise<void> } | null = null;

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!supportsAutoUpdate()) return null;

  const electron = electronBridge();
  if (electron) {
    const found = await electron.checkForUpdate();
    if (!found) return null;
    const available: AvailableUpdate = {
      ...found,
      install: (onProgress) => electron.downloadUpdate(onProgress),
    };
    for (const listener of listeners) listener(available);
    return available;
  }

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();

  if (handle) {
    await handle.close().catch((error: unknown) => {
      console.debug('[sable updates] releasing the previous update failed', error);
    });
  }
  handle = update;
  if (!update) return null;

  const available: AvailableUpdate = {
    version: update.version,
    notes: update.body,
    install: async (onProgress) => {
      let downloaded = 0;
      let total = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          onProgress(total > 0 ? Math.min(Math.round((downloaded / total) * 100), 100) : 0);
        }
      });
      handle = null;
    },
  };
  for (const listener of listeners) listener(available);

  return available;
}

export async function relaunchApp(): Promise<void> {
  const electron = electronBridge();
  if (electron) {
    await electron.installUpdate();
    return;
  }
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
