import { expect, test, vi } from 'vitest';

import {
  ADDED_SERVERS_ACCOUNT_DATA_TYPE,
  addServer,
  exploreServers,
  isServerName,
  readAddedServers,
  removeServer,
} from './explore-servers';

function fakeCommands(content: unknown) {
  return {
    data: vi.fn(() => Promise.resolve(content)),
    setData: vi.fn(() => Promise.resolve(null)),
  };
}

test('server names follow the Matrix grammar', () => {
  expect(isServerName('matrix.org')).toBe(true);
  expect(isServerName('localhost:8448')).toBe(true);
  expect(isServerName('[::1]:8448')).toBe(true);
  expect(isServerName('https://matrix.org')).toBe(false);
  expect(isServerName('matrix org')).toBe(false);
});

test('added servers are read from the v1 account data, ignoring junk', async () => {
  expect(await readAddedServers(fakeCommands({ servers: ['a.org', 3, 'b.org'] }))).toEqual([
    'a.org',
    'b.org',
  ]);
  expect(await readAddedServers(fakeCommands(null))).toEqual([]);
});

test('adding a server appends it once', async () => {
  const commands = fakeCommands({ servers: ['a.org'] });

  expect(await addServer(commands, 'b.org')).toEqual(['a.org', 'b.org']);
  expect(commands.setData).toHaveBeenCalledWith({
    event_type: ADDED_SERVERS_ACCOUNT_DATA_TYPE,
    content: {
      servers: ['a.org', 'b.org'],
    },
  });

  expect(await addServer(commands, 'A.org')).toEqual(['a.org']);
  expect(commands.setData).toHaveBeenCalledTimes(1);
});

test('concurrent additions keep both servers', async () => {
  let content: unknown = { servers: ['a.org'] };
  const commands = {
    data: vi.fn(() => Promise.resolve(content)),
    setData: vi.fn(({ content: next }: { content: unknown }) => {
      content = next;
      return Promise.resolve(null);
    }),
  };

  await Promise.all([addServer(commands, 'b.org'), addServer(commands, 'c.org')]);

  expect(content).toEqual({ servers: ['a.org', 'b.org', 'c.org'] });
});

test('removing a server ignores case', async () => {
  const commands = fakeCommands({ servers: ['a.org', 'b.org'] });

  expect(await removeServer(commands, 'B.ORG')).toEqual(['a.org']);
});

test('the list starts with the own server and drops repeats', () => {
  expect(exploreServers('own.org', ['a.org', 'own.org'], ['A.org', 'b.org'])).toEqual([
    'own.org',
    'a.org',
    'b.org',
  ]);
  expect(exploreServers(null, [], ['b.org'])).toEqual(['b.org']);
});
