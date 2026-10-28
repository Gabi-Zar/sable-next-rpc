import { afterEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ identity: null as string | null }));
vi.mock('#lib/notifications/room-names.js', () => ({
  boundServerIdentity: () => state.identity,
  bindServerNotificationIdentity: async () => {},
}));

import { readText, removeLocalValue, writeText } from './local-json.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  state.identity = null;
});

test('server users do not share local values and unauthenticated reads are empty', () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
  vi.stubEnv('VITE_SABLE_SERVER_URL', '/_sable/ws');
  data.set('private', 'old unscoped value');
  expect(readText('private')).toBeNull();
  state.identity = 'legacy';
  expect(readText('private')).toBe('old unscoped value');
  expect(data.get('sable.server-user.legacy.private')).toBe('old unscoped value');
  removeLocalValue('private');
  expect(readText('private')).toBeNull();
  state.identity = 'alice';
  expect(readText('private')).toBeNull();
  writeText('private', 'alice value');
  state.identity = 'bob';
  expect(readText('private')).toBeNull();
  writeText('private', 'bob value');
  state.identity = 'alice';
  expect(readText('private')).toBe('alice value');
});
