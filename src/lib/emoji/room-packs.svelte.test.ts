// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { expect, test, vi } from 'vitest';

import type { CoreEvent, ImagePackView } from '#src/generated/protocol';

import { RoomPacks } from './room-packs.svelte.js';

function pack(id: string): ImagePackView {
  return { id, images: [] } as unknown as ImagePackView;
}

function fakeCore(responses: ImagePackView[][]) {
  const listeners = new Set<(event: CoreEvent) => void>();
  const list = vi.fn(({ cached_only }: { cached_only: boolean }) =>
    Promise.resolve(
      cached_only
        ? { packs: [], complete: false }
        : { packs: responses.shift() ?? [], complete: false }
    )
  );
  return {
    core: {
      rpc: { packs: { list } },
      session: null,
      subscribeEvents: (listener: (event: CoreEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as ConstructorParameters<typeof RoomPacks>[0],
    emit: (event: CoreEvent) => {
      for (const listener of listeners) listener(event);
    },
    listeners,
  };
}

test('loads the room packs and reloads them when packs change', async () => {
  const { core, emit, listeners } = fakeCore([[pack('first')], [pack('second')]]);
  let packs!: RoomPacks;
  const stop = $effect.root(() => {
    packs = new RoomPacks(core, () => '!room:example.org');
  });
  flushSync();

  await vi.waitFor(() => {
    flushSync();
    expect(packs.current.map((p) => p.id)).toEqual(['first']);
  });

  emit({ type: 'typing', room_id: '!room:example.org', user_ids: [] });
  emit({ type: 'image_packs_changed' } as unknown as CoreEvent);
  await vi.waitFor(() => {
    flushSync();
    expect(packs.current.map((p) => p.id)).toEqual(['second']);
  });

  stop();
  expect(listeners.size).toBe(0);
});
