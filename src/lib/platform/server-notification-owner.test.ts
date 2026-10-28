import { afterEach, expect, test, vi } from 'vitest';

import {
  bindServerNotificationOwner,
  clearServerNotifications,
} from './server-notification-owner.js';

afterEach(() => vi.unstubAllGlobals());

test('closes notifications when the browser switches server users', async () => {
  let owner: string | null = 'legacy';
  const close = vi.fn();
  vi.stubGlobal('localStorage', {
    getItem: () => owner,
    setItem: (_key: string, value: string) => {
      owner = value;
    },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve({ getNotifications: () => Promise.resolve([{ close }]) }),
    },
  });
  const clearPrevious = vi.fn(() => Promise.resolve());
  await bindServerNotificationOwner('legacy', clearPrevious);
  expect(close).not.toHaveBeenCalled();
  await bindServerNotificationOwner('bob', clearPrevious);
  expect(clearPrevious).toHaveBeenCalledWith('legacy');
  expect(close).toHaveBeenCalledTimes(1);
  expect(owner).toBe('bob');
  await clearServerNotifications();
  expect(close).toHaveBeenCalledTimes(2);
});

test('clears notifications when ownership cannot be stored', async () => {
  const close = vi.fn();
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve({ getNotifications: () => Promise.resolve([{ close }]) }),
    },
  });
  await bindServerNotificationOwner('alice', () => Promise.resolve());
  expect(close).toHaveBeenCalledOnce();
});

test('does not bind a new user if previous credentials could not be removed', async () => {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => 'legacy', setItem });
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: () => Promise.resolve(undefined) },
  });
  await expect(
    bindServerNotificationOwner('bob', () => Promise.reject(new Error('blocked')))
  ).rejects.toThrow('blocked');
  expect(setItem).not.toHaveBeenCalled();
});
