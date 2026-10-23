import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { electronBridge } from './electron';

export function deliversDeepLinks(): boolean {
  return isTauri() || electronBridge() !== undefined;
}

export async function subscribeDeepLinks(onUrls: (urls: string[]) => void): Promise<() => void> {
  const electron = electronBridge();
  if (electron) return electron.onDeepLinks(onUrls);
  if (!isTauri()) return () => {};

  try {
    return await listen<string[]>('deep-link://new-url', (event) => {
      onUrls(event.payload);
    });
  } catch {
    return () => {};
  }
}

async function invokedLinks(command: string): Promise<string[]> {
  try {
    return (await invoke<string[] | null>(command)) ?? [];
  } catch {
    return [];
  }
}

async function launchDeepLinks(): Promise<string[]> {
  const electron = electronBridge();
  if (electron) return electron.takeDeepLinks();
  if (!isTauri()) return [];

  return [
    ...(await invokedLinks('plugin:deep-link|get_current')),
    ...(await invokedLinks('pending_deep_links')),
  ];
}

let launchLinks: Promise<string[]> | undefined;

// Login and permalink handlers share the launch queue without consuming each other's links.
export async function currentDeepLinks(
  accepts: (url: string) => boolean = () => true
): Promise<string[]> {
  launchLinks ??= launchDeepLinks();
  const pending = await launchLinks;
  const accepted = pending.filter(accepts);
  const remaining = pending.filter((url) => !accepts(url));
  pending.splice(0, pending.length, ...remaining);
  return accepted;
}
