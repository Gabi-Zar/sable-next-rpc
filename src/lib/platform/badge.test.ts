import { afterEach, expect, it, vi } from 'vitest';

import { setUnreadBadge } from './badge.js';
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
