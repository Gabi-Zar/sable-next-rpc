import { expect, test, vi } from 'vitest';
import { belongsToServerUser, clientHasServerIdentity } from './push-scope.js';

test('only accepts push for a session in the current server-user database', async () => {
  const lookup = vi.fn((userId: string) =>
    Promise.resolve(
      userId === '@alice:example.org'
        ? { userId, homeserver: 'https://example.org', accessToken: 'token' }
        : null
    )
  );
  expect(await belongsToServerUser('@alice:example.org', lookup)).toBe(true);
  expect(await belongsToServerUser('@bob:example.org', lookup)).toBe(false);
  expect(await belongsToServerUser(null, lookup)).toBe(false);
});

test('only selects tabs bound to the requested server user', async () => {
  const tab = (identity: string) => ({
    postMessage: (_message: unknown, ports: MessagePort[]) => {
      ports[0]?.postMessage(identity);
    },
  });
  expect(await clientHasServerIdentity(tab('alice'), 'alice')).toBe(true);
  expect(await clientHasServerIdentity(tab('bob'), 'alice')).toBe(false);
});
