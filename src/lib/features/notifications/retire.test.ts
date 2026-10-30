// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dismissRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#lib/platform/native-notifications.js', () => ({
  dismissNativeRoomNotifications: vi.fn().mockResolvedValue(undefined),
  dismissNativeReadRoomNotifications: mocks.dismissRead,
}));

import { retireReadAlerts } from './retire';
import { roomTag } from './tag';

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.dismissRead.mockClear();
});

function presented(...tags: string[]) {
  const shown = tags.map((tag) => ({ tag, close: vi.fn() }));
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: () => Promise.resolve({ getNotifications: () => shown }) },
  });
  return shown;
}

function posted(...notifications: { tag: string; data: unknown }[]) {
  const shown = notifications.map(({ tag, data }) => ({ tag, data, close: vi.fn() }));
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: () => Promise.resolve({ getNotifications: () => shown }) },
  });
  return shown;
}

test('closes the alerts of read rooms and nothing else', async () => {
  const [read, unread, otherAccount] = presented(
    roomTag('@me:example.org', '!read:example.org'),
    roomTag('@me:example.org', '!unread:example.org'),
    roomTag('@other:example.org', '!read:example.org')
  );

  await retireReadAlerts('@me:example.org', ['!read:example.org']);

  expect(read.close).toHaveBeenCalledOnce();
  expect(unread.close).not.toHaveBeenCalled();
  expect(otherAccount.close).not.toHaveBeenCalled();
  expect(mocks.dismissRead).toHaveBeenCalledExactlyOnceWith('@me:example.org', [
    '!read:example.org',
  ]);
});

test('closes every message banner posted for a read room', async () => {
  const room = roomTag('@me:example.org', '!read:example.org');
  const [first, second, unread, otherAccount] = posted(
    { tag: `${room}:$one`, data: { roomId: '!read:example.org', userId: '@me:example.org' } },
    { tag: `${room}:$two`, data: { roomId: '!read:example.org', userId: '@me:example.org' } },
    { tag: 'unread', data: { roomId: '!unread:example.org', userId: '@me:example.org' } },
    { tag: 'other', data: { roomId: '!read:example.org', userId: '@other:example.org' } }
  );

  await retireReadAlerts('@me:example.org', ['!read:example.org']);

  expect(first.close).toHaveBeenCalledOnce();
  expect(second.close).toHaveBeenCalledOnce();
  expect(unread.close).not.toHaveBeenCalled();
  expect(otherAccount.close).not.toHaveBeenCalled();
});

test('a browser that cannot list notifications still retires native alerts', async () => {
  vi.stubGlobal('navigator', {
    serviceWorker: { getRegistration: () => Promise.resolve({}) },
  });

  await retireReadAlerts('@me:example.org', ['!read:example.org']);

  expect(mocks.dismissRead).toHaveBeenCalledOnce();
});

test('asks nothing of the platform when no room is read', async () => {
  presented();

  await retireReadAlerts('@me:example.org', []);

  expect(mocks.dismissRead).not.toHaveBeenCalled();
});

test('reading a room retires messages while keeping its active call banner', async () => {
  const message = {
    data: { roomId: '!room:example.org', userId: '@me:example.org' },
    tag: '',
    close: vi.fn(),
  };
  const call = {
    data: { ...message.data, call: true, callExpiresAtMs: Date.now() + 90000 },
    tag: '@me:example.org !room:example.org:$call',
    close: vi.fn(),
  };
  const expired = {
    data: { ...call.data, callExpiresAtMs: Date.now() - 1 },
    tag: '',
    close: vi.fn(),
  };
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: () =>
        Promise.resolve({
          getNotifications: () => Promise.resolve([message, call, expired]),
        }),
    },
  });
  await retireReadAlerts('@me:example.org', ['!room:example.org']);
  expect(message.close).toHaveBeenCalledOnce();
  expect(call.close).not.toHaveBeenCalled();
  expect(expired.close).toHaveBeenCalledOnce();
});
