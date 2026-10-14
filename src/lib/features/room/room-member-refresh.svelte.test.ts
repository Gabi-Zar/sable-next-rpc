// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { expect, test, vi } from 'vitest';
import type { CoreEvent } from '#src/generated/protocol';
import { refreshRoomMembers } from './room-member-refresh.svelte.js';

function setup() {
  let emit!: (event: CoreEvent) => void;
  const refresh = vi.fn(() => Promise.resolve());
  const core = {
    rpc: { members: { list: vi.fn() } },
    onProfileChanged: () => () => {},
    subscribeEvents: (listener: (event: CoreEvent) => void) => {
      emit = listener;
      return () => {};
    },
  };
  const cleanup = $effect.root(() => {
    refreshRoomMembers(core as never, { refresh }, () => '!room:example.org');
  });
  flushSync();
  return { emit, refresh, cleanup };
}

test('refreshes the members of the open room when its membership changes', () => {
  const { emit, refresh, cleanup } = setup();
  emit({ type: 'members_changed', room_id: '!other:example.org' });
  expect(refresh).not.toHaveBeenCalled();

  emit({ type: 'members_changed', room_id: '!room:example.org' });
  expect(refresh).toHaveBeenCalledWith('!room:example.org', expect.any(Function));
  cleanup();
});
