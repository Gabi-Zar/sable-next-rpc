import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickBadgeStrategy, setUnreadBadge } from './badge.js';
import type { ElectronBridge } from './electron';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('uses the Electron Linux tray without the web Badging API', async () => {
  const setTrayUnread = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('sableElectron', {
    platform: 'linux',
    setTrayUnread,
  } satisfies Pick<ElectronBridge, 'platform' | 'setTrayUnread'>);
  vi.stubGlobal('navigator', {});

  await setUnreadBadge(3);
  await setUnreadBadge(0);
  expect(setTrayUnread.mock.calls).toEqual([[true], [false]]);
});

it('sets and clears the browser badge', async () => {
  const setAppBadge = vi.fn().mockResolvedValue(undefined);
  const clearAppBadge = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { setAppBadge, clearAppBadge });

  await setUnreadBadge(3);
  await setUnreadBadge(0);
  expect(setAppBadge).toHaveBeenCalledWith(3);
  expect(clearAppBadge).toHaveBeenCalledOnce();
});

describe('pickBadgeStrategy', () => {
  it('uses the Tauri window API on Windows and macOS', () => {
    expect(pickBadgeStrategy(true, 'windows', false)).toBe('tauri-window');
    expect(pickBadgeStrategy(true, 'macos', false)).toBe('tauri-window');
  });

  it('marks the tray icon on Linux, which has no window badge', () => {
    expect(pickBadgeStrategy(true, 'linux', false)).toBe('tauri-tray');
  });

  it('has no desktop badge concept on mobile Tauri builds', () => {
    expect(pickBadgeStrategy(true, 'android', false)).toBe('none');
    expect(pickBadgeStrategy(true, 'ios', false)).toBe('none');
  });

  it('falls back to the web Badging API outside Tauri when it exists', () => {
    expect(pickBadgeStrategy(false, '', true)).toBe('web-app-badge');
    expect(pickBadgeStrategy(false, '', false)).toBe('none');
  });
});
