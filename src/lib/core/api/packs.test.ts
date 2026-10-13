import { expect, test, vi } from 'vitest';
import { createRpc } from '#src/generated/protocol';
import { imagePackListing } from './packs.js';

test.each([false, true])('loads room packs (cachedOnly=%s)', async (cachedOnly) => {
  const call = vi.fn(() => Promise.resolve({ packs: [], complete: !cachedOnly }));
  const rpc = createRpc(call);

  await expect(imagePackListing(rpc, '!room:example.org', cachedOnly)).resolves.toEqual({
    packs: [],
    complete: !cachedOnly,
  });
  expect(call).toHaveBeenCalledExactlyOnceWith('packs.list', {
    room_id: '!room:example.org',
    cached_only: cachedOnly,
  });
});

test('leaves account-wide listings uncached', async () => {
  const call = vi.fn(() => Promise.resolve([]));
  const rpc = createRpc(call);

  await expect(imagePackListing(rpc, '', true)).resolves.toEqual({
    packs: [],
    complete: false,
  });
  expect(call).not.toHaveBeenCalled();
  await expect(imagePackListing(rpc, '')).resolves.toEqual({ packs: [], complete: false });
  expect(call).toHaveBeenCalledExactlyOnceWith('packs.list_all', {});
});
