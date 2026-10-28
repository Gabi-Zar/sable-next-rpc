import { expect, test, vi } from 'vitest';

import type { CoreEvent } from '#src/generated/protocol';

const stored = vi.hoisted(() => ({
  put: vi.fn(() => Promise.resolve()),
  forget: vi.fn(() => Promise.resolve()),
  identity: 'alice',
}));

vi.mock('#lib/notifications/room-names.js', () => ({
  putPushSession: stored.put,
  forgetPushSession: stored.forget,
  boundServerIdentity: () => 'alice',
  currentServerUser: () => Promise.resolve(stored.identity),
}));

import { answerPushEvent, sharePushSession } from './push-session';

function sharer(token: string | null) {
  let listener: ((event: CoreEvent) => void) | null = null;
  const accessToken = vi.fn(() => Promise.resolve(token));
  const core = {
    session: {
      user_id: '@me:example.org',
      device_id: 'DEVICE',
      homeserver: 'https://hs.example/',
    },
    rpc: { session: { accessToken } },
    subscribeEvents: (onEvent: (event: CoreEvent) => void) => {
      listener = onEvent;
      return () => {
        listener = null;
      };
    },
  } as unknown as Parameters<typeof sharePushSession>[0];
  return { core, accessToken, emit: (event: CoreEvent) => listener?.(event) };
}

test('the worker is handed the token, and handed it again when it is refreshed', async () => {
  stored.put.mockClear();
  const { core, accessToken, emit } = sharer('token');

  const stop = sharePushSession(core);
  await vi.waitFor(() => {
    expect(stored.put).toHaveBeenCalledWith({
      userId: '@me:example.org',
      deviceId: 'DEVICE',
      homeserver: 'https://hs.example/',
      accessToken: 'token',
    });
  });
  emit({ type: 'session_tokens_refreshed' });
  expect(accessToken).toHaveBeenCalledTimes(2);

  stop();
  emit({ type: 'session_tokens_refreshed' });
  expect(accessToken).toHaveBeenCalledTimes(2);
});

test('a session with no token takes the stored one away', async () => {
  stored.forget.mockClear();
  sharePushSession(sharer(null).core);

  await vi.waitFor(() => {
    expect(stored.forget).toHaveBeenCalledWith('@me:example.org');
  });
});

test('a tab only decrypts a push for the account it has open', async () => {
  const pushEvent = vi.fn(() => Promise.resolve({ kind: 'discard' as const }));
  const core = {
    session: { user_id: '@me:example.org' },
    rpc: { notifications: { pushEvent } },
  } as unknown as Parameters<typeof answerPushEvent>[0];

  expect(
    await answerPushEvent(core, { roomId: '!r', eventId: '$e', userId: '@me:example.org' })
  ).toEqual({ kind: 'discard' });
  expect(
    await answerPushEvent(core, { roomId: '!r', eventId: '$e', userId: '@other:example.org' })
  ).toBeNull();
  expect(await answerPushEvent(core, { roomId: '!r' })).toBeNull();
  expect(pushEvent).toHaveBeenCalledTimes(1);
});

test('server tabs answer push requests only for their bound server user', async () => {
  vi.stubEnv('VITE_SABLE_SERVER_URL', '/_sable/ws');
  try {
    const pushEvent = vi.fn(() => Promise.resolve({ kind: 'discard' as const }));
    const core = {
      session: { user_id: '@me:example.org' },
      rpc: { notifications: { pushEvent } },
    } as unknown as Parameters<typeof answerPushEvent>[0];
    const request = { roomId: '!r', eventId: '$e', userId: '@me:example.org' };
    expect(await answerPushEvent(core, request)).toBeNull();
    expect(await answerPushEvent(core, { ...request, serverUserId: 'bob' })).toBeNull();
    stored.identity = 'bob';
    expect(await answerPushEvent(core, { ...request, serverUserId: 'alice' })).toBeNull();
    stored.identity = 'alice';
    expect(await answerPushEvent(core, { ...request, serverUserId: 'alice' })).toEqual({
      kind: 'discard',
    });
    expect(pushEvent).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllEnvs();
  }
});
