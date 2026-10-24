// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

import type { CallLifecycle } from './call-session.svelte.js';

const system = vi.hoisted(() => ({
  end: vi.fn((_callId: string) => Promise.resolve(true)),
  fulfill: vi.fn((_uuid: string) => Promise.resolve()),
}));

vi.mock('#lib/platform/calls.js', () => ({
  endSystemCall: system.end,
  fulfillSystemAnswer: system.fulfill,
}));

import { SystemCalls } from './system-calls.svelte.js';

function harness() {
  const session = $state<{ lifecycle: CallLifecycle; roomId: string | null }>({
    lifecycle: 'idle',
    roomId: null,
  });
  const calls = new SystemCalls(session);
  const stop = $effect.root(() => {
    calls.track();
  });
  flushSync();
  const join = () => {
    session.roomId = '!a:x';
    session.lifecycle = 'active';
    return Promise.resolve();
  };
  return { session, calls, stop, join };
}

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllMocks();
});

test('ends an answered call when the session leaves its room', async () => {
  const h = harness();
  stop = h.stop;
  await h.calls.answer('uuid-1', 'uuid-1', '!a:x', h.join);
  flushSync();

  expect(system.fulfill).toHaveBeenCalledWith('uuid-1');
  expect(system.end).not.toHaveBeenCalled();

  h.session.roomId = null;
  h.session.lifecycle = 'idle';
  flushSync();

  expect(system.end).toHaveBeenCalledOnce();
  expect(system.end).toHaveBeenCalledWith('uuid-1');
});

test('ends an answered call when the session fails', async () => {
  const h = harness();
  stop = h.stop;
  await h.calls.answer('uuid-1', 'uuid-1', '!a:x', h.join);
  flushSync();

  h.session.lifecycle = 'failed';
  flushSync();

  expect(system.end).toHaveBeenCalledWith('uuid-1');
});

test('fulfills the answer even when joining fails', async () => {
  const h = harness();
  stop = h.stop;
  vi.spyOn(console, 'debug').mockImplementation(() => {});

  await h.calls.answer('uuid-1', 'uuid-1', '!a:x', () => Promise.reject(new Error('busy')));
  flushSync();

  expect(system.fulfill).toHaveBeenCalledWith('uuid-1');
  expect(system.end).not.toHaveBeenCalled();
});
