// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { CallLifecycle } from './call-session.svelte.js';

const system = vi.hoisted(() => ({
  platform: 'ios',
  start: vi.fn((_call: { callId: string; uuid: string; callerName: string }) =>
    Promise.resolve(true)
  ),
  end: vi.fn((_callId: string) => Promise.resolve(true)),
  fulfill: vi.fn((_uuid: string) => Promise.resolve()),
  connected: vi.fn((_uuid: string) => Promise.resolve()),
}));

vi.mock('#lib/platform/os.js', () => ({ isIos: () => system.platform === 'ios' }));

vi.mock('#lib/platform/calls.js', () => ({
  startSystemCall: system.start,
  endSystemCall: system.end,
  fulfillSystemAnswer: system.fulfill,
  reportSystemCallConnected: system.connected,
}));

import { SystemCalls } from './system-calls.svelte.js';

function harness() {
  const session = $state<{
    lifecycle: CallLifecycle;
    roomId: string | null;
    nativeCallId: string | undefined;
  }>({ lifecycle: 'idle', roomId: null, nativeCallId: undefined });
  const calls = new SystemCalls(session, (roomId) => (roomId === '!a:x' ? 'Room A' : undefined));
  const stop = $effect.root(() => {
    calls.track();
  });
  flushSync();
  const connect = (roomId: string, callId: string | null = '7') => {
    session.roomId = roomId;
    session.nativeCallId = callId ?? undefined;
    session.lifecycle = 'active';
    flushSync();
  };
  return { session, calls, stop, connect };
}

let stop: (() => void) | undefined;

beforeEach(() => {
  system.platform = 'ios';
});

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.clearAllMocks();
});

test('reports an outgoing CallKit call bound to the native call on iOS', () => {
  const h = harness();
  stop = h.stop;

  h.connect('!a:x');

  expect(system.start).toHaveBeenCalledOnce();
  expect(system.start.mock.calls[0][0]).toMatchObject({ callId: '7', callerName: 'Room A' });
});

test('reports the outgoing call connected once CallKit accepts it', async () => {
  const h = harness();
  stop = h.stop;

  h.connect('!a:x');
  await vi.waitFor(() => {
    expect(system.connected).toHaveBeenCalledOnce();
  });

  expect(system.connected).toHaveBeenCalledWith(system.start.mock.calls[0][0].uuid);
});

test('warns when CallKit refuses the outgoing call', async () => {
  const h = harness();
  stop = h.stop;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  system.start.mockResolvedValueOnce(false);

  h.connect('!a:x');
  await vi.waitFor(() => {
    expect(warn).toHaveBeenCalledOnce();
  });

  expect(system.connected).not.toHaveBeenCalled();
});

test('ends a call left before CallKit accepted it', async () => {
  const h = harness();
  stop = h.stop;
  let accept!: (started: boolean) => void;
  system.start.mockReturnValueOnce(new Promise((resolve) => (accept = resolve)));
  h.connect('!a:x');

  h.session.lifecycle = 'idle';
  h.session.roomId = null;
  flushSync();
  accept(true);
  await vi.waitFor(() => {
    expect(system.end).toHaveBeenCalledTimes(2);
  });

  expect(system.connected).not.toHaveBeenCalled();
});

test('falls back to the room id when the room has no name', () => {
  const h = harness();
  stop = h.stop;

  h.connect('!b:x');

  expect(system.start.mock.calls[0][0].callerName).toBe('!b:x');
});

test('waits until the call is active', () => {
  const h = harness();
  stop = h.stop;

  h.session.roomId = '!a:x';
  h.session.nativeCallId = '7';
  h.session.lifecycle = 'connecting';
  flushSync();

  expect(system.start).not.toHaveBeenCalled();
});

test.each(['android', 'linux'])('does not report a system call on %s', (platform) => {
  system.platform = platform;
  const h = harness();
  stop = h.stop;

  h.connect('!a:x');

  expect(system.start).not.toHaveBeenCalled();
});

test('does not report a system call for a web transport', () => {
  const h = harness();
  stop = h.stop;

  h.connect('!a:x', null);

  expect(system.start).not.toHaveBeenCalled();
});

test('ends the outgoing call when the session leaves', () => {
  const h = harness();
  stop = h.stop;
  h.connect('!a:x');

  h.session.lifecycle = 'idle';
  h.session.roomId = null;
  flushSync();

  expect(system.end).toHaveBeenCalledWith('7');
});

test('ends the outgoing call when the session fails', () => {
  const h = harness();
  stop = h.stop;
  h.connect('!a:x');

  h.session.lifecycle = 'failed';
  flushSync();

  expect(system.end).toHaveBeenCalledWith('7');
});

test('reports a new call after a retry', () => {
  const h = harness();
  stop = h.stop;
  h.connect('!a:x');
  h.session.lifecycle = 'failed';
  flushSync();

  h.connect('!a:x', '8');

  expect(system.start).toHaveBeenCalledTimes(2);
  expect(system.start.mock.calls[1][0].callId).toBe('8');
});

test('does not report an outgoing call for an answered CallKit call', async () => {
  const h = harness();
  stop = h.stop;

  await h.calls.answer('uuid-1', 'uuid-1', '!a:x', () => {
    h.connect('!a:x');
    return Promise.resolve();
  });
  flushSync();

  expect(system.start).not.toHaveBeenCalled();
  expect(system.fulfill).toHaveBeenCalledWith('uuid-1');

  h.session.roomId = null;
  h.session.lifecycle = 'idle';
  flushSync();

  expect(system.end).toHaveBeenCalledOnce();
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
