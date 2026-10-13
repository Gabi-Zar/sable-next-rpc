import { expect, test, vi } from 'vitest';

import type { CoreEvent } from '#src/generated/protocol';

import { AccountDataSync } from './account-data-sync';
import type { CoreClient } from './client.svelte.js';

function probe() {
  const pulls: number[] = [];
  const sync = new AccountDataSync(['a.event', 'b.event'], (generation) => {
    pulls.push(generation);
    return Promise.resolve();
  });
  return { sync, pulls };
}

function fakeCore() {
  const listeners = new Set<(event: CoreEvent) => void>();
  const core = {
    subscribeEvents: (listener: (event: CoreEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as CoreClient;
  const emit = (event_type: string) => {
    for (const listener of listeners) listener({ type: 'account_data_changed', event_type });
  };
  return { core, listeners, emit };
}

test('pulls on start and on matching account data changes only', () => {
  const { sync, pulls } = probe();
  const fake = fakeCore();

  sync.start(fake.core);
  fake.emit('b.event');
  fake.emit('other.event');

  expect(pulls).toEqual([1, 1]);
});

test('restarting replaces the subscription and stopping ends it', () => {
  const { sync, pulls } = probe();
  const first = fakeCore();
  const second = fakeCore();
  const unsubscribe = vi.spyOn(first.listeners, 'delete');

  sync.start(first.core);
  sync.start(second.core);
  expect(unsubscribe).toHaveBeenCalledOnce();
  second.emit('a.event');
  expect(pulls).toEqual([1, 2, 2]);

  sync.stop();
  second.emit('a.event');
  expect(second.listeners.size).toBe(0);
  expect(pulls).toEqual([1, 2, 2]);
});
