import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { CoreClient } from '#lib/core/client.svelte.js';

import { UserDirectoryLookup } from './user-directory-lookup.svelte';

function fakeCore(searchUserDirectory: (args: { term: string }) => Promise<unknown>) {
  return {
    rpc: { account: { searchUserDirectory: vi.fn(searchUserDirectory) } },
  } as unknown as CoreClient & {
    rpc: { account: { searchUserDirectory: ReturnType<typeof vi.fn> } };
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('debounces and keeps only the latest query results', async () => {
  const core = fakeCore(({ term }) =>
    Promise.resolve({ results: [{ user_id: `@${term}:x`, display_name: null, avatar_url: null }] })
  );
  const lookup = new UserDirectoryLookup(core);

  lookup.search('a');
  lookup.search('ab');
  expect(lookup.searching).toBe(true);
  await vi.advanceTimersByTimeAsync(300);

  expect(core.rpc.account.searchUserDirectory).toHaveBeenCalledOnce();
  expect(core.rpc.account.searchUserDirectory).toHaveBeenCalledWith({ term: 'ab', limit: 10 });
  expect(lookup.results.map((entry) => entry.user_id)).toEqual(['@ab:x']);
  expect(lookup.searching).toBe(false);
});

test('an empty query clears results and a cancelled lookup never runs', async () => {
  const core = fakeCore(() => Promise.resolve({ results: [] }));
  const lookup = new UserDirectoryLookup(core);

  lookup.search('a');
  lookup.cancel();
  await vi.advanceTimersByTimeAsync(300);
  expect(core.rpc.account.searchUserDirectory).not.toHaveBeenCalled();

  lookup.search('');
  expect(lookup.searching).toBe(false);
  expect(lookup.results).toEqual([]);
});

test('a failed lookup leaves no results', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const core = fakeCore(() => Promise.reject(new Error('down')));
  const lookup = new UserDirectoryLookup(core);

  lookup.search('a');
  await vi.advanceTimersByTimeAsync(300);

  expect(lookup.results).toEqual([]);
  expect(lookup.searching).toBe(false);
});
