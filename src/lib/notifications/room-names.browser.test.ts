import { afterEach, expect, test, vi } from 'vitest';

import {
  bindServerNotificationIdentity,
  clearServerPushSessions,
  putPushSession,
  pushSession,
  putRoomNames,
  roomName,
  expectPushActivation,
  pendingPushActivations,
  pushContentPolicy,
  PUSH_ACTIVATION_TTL_MS,
  settlePushActivation,
} from './room-names.js';

test('missing push policy clears alerts by default', async () => {
  await expect(pushContentPolicy()).resolves.toMatchObject({ clearOnRead: true });
});

afterEach(async () => {
  await settlePushActivation('@me:example.org');
  await settlePushActivation('@alt:example.org');
});

test('a registered account awaits activation until its token would expire', async () => {
  await expectPushActivation('@me:example.org');

  await expect(pendingPushActivations(Date.now())).resolves.toEqual(['@me:example.org']);
  await expect(pendingPushActivations(Date.now() + PUSH_ACTIVATION_TTL_MS)).resolves.toEqual([]);
});

test('settling one account leaves the others pending', async () => {
  await expectPushActivation('@me:example.org');
  await expectPushActivation('@alt:example.org');

  await settlePushActivation('@me:example.org');

  await expect(pendingPushActivations(Date.now())).resolves.toEqual(['@alt:example.org']);
});

test('server notification data stays bound to the signed-in user', async () => {
  vi.stubEnv('VITE_SABLE_SERVER_URL', '/');
  let id = '11111111-1111-4111-8111-111111111111';
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response(JSON.stringify({ id }), { status: 200 }))
  );
  try {
    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('sable-notifications', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('room-names');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB request failed'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = legacyDatabase.transaction('room-names', 'readwrite');
      transaction
        .objectStore('room-names')
        .put({ accessToken: 'legacy-token' }, '\u0000session:@old:example.org');
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      };
    });
    await bindServerNotificationIdentity();
    const oldToken = await new Promise<unknown>((resolve, reject) => {
      const request = legacyDatabase
        .transaction('room-names')
        .objectStore('room-names')
        .get('\u0000session:@old:example.org');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB request failed'));
      };
    });
    legacyDatabase.close();
    expect(oldToken).toBeUndefined();
    await putRoomNames(new Map([['!private:example.org', 'Alice private room']]));
    expect(await roomName('!private:example.org')).toBe('Alice private room');
    await putPushSession({
      userId: '@me:example.org',
      homeserver: 'https://example.org',
      accessToken: 'private-token',
    });
    expect((await pushSession('@me:example.org'))?.accessToken).toBe('private-token');
    await clearServerPushSessions(id);
    expect(await pushSession('@me:example.org')).toBeNull();
    id = '22222222-2222-4222-8222-222222222222';
    await expect(putRoomNames(new Map([['!private:example.org', 'wrong user']]))).rejects.toThrow(
      'server identity changed'
    );
    await expect(bindServerNotificationIdentity()).rejects.toThrow('server identity changed');
    expect(await roomName('!private:example.org')).toBeNull();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
