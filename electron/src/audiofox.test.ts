import type { AudioRequest } from './audiofox-protocol';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const utility = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock('electron', () => ({ utilityProcess: utility }));
class Child extends EventEmitter {
  postMessage = vi.fn<(message: AudioRequest | { command: 'ack' }) => void>();
  kill = vi.fn(() => {
    this.emit('exit', 0);
    return true;
  });
  stderr = null;
  reply(value?: string[], error?: string): void {
    const request = this.postMessage.mock.calls.findLast(
      ([message]) => message.command !== 'ack'
    )?.[0];
    if (!request || request.command === 'ack') throw new Error('No pending request');
    this.emit('message', { type: 'reply', id: request.id, value, error });
  }
}
let children: Child[];
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal('__dirname', '/audio');
  children = [];
  utility.fork.mockImplementation(() => {
    const child = new Child();
    children.push(child);
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
});
afterEach(async () => {
  const audio = await import('./audiofox');
  audio.stop();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('lists sources asynchronously and passes the Electron parent PID', async () => {
  const audio = await import('./audiofox');
  const listing = audio.listApps();
  await Promise.resolve();
  expect(children[0].postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ command: 'list', rootPid: process.pid })
  );
  children[0].reply(['audiofox:music']);
  expect(await listing).toEqual({
    status: 'available',
    apps: [{ id: 'audiofox:music', label: 'music' }],
  });
});

test('kills a stalled listing and capture without blocking the main loop', async () => {
  const audio = await import('./audiofox');
  const listing = expect(audio.listApps()).rejects.toThrow('timed out');
  const tick = vi.fn();
  setTimeout(tick, 10);
  await vi.advanceTimersByTimeAsync(5000);
  await listing;
  expect(tick).toHaveBeenCalledOnce();
  expect(children[0].kill).toHaveBeenCalledOnce();
  const starting = expect(audio.start(['audiofox:music'], vi.fn())).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(5000);
  await starting;
  expect(children[1].kill).toHaveBeenCalledOnce();
});

test('stops a stalled helper within the shutdown deadline and drops late frames', async () => {
  const audio = await import('./audiofox');
  const frames = vi.fn();
  const starting = audio.start(['audiofox:music'], frames);
  await Promise.resolve();
  children[0].reply();
  await starting;
  children[0].emit('message', { type: 'frames', data: Buffer.from([1, 2]) });
  expect(frames).toHaveBeenCalledOnce();
  expect(children[0].postMessage).toHaveBeenLastCalledWith({ command: 'ack' });
  audio.stop();
  children[0].emit('message', { type: 'frames', data: Buffer.from([3, 4]) });
  expect(frames).toHaveBeenCalledOnce();
  expect(children[0].kill).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  expect(children[0].kill).toHaveBeenCalledOnce();
});

test('a cancelled start cannot stop its replacement', async () => {
  const audio = await import('./audiofox');
  const previous = expect(audio.start(['audiofox:old'], vi.fn())).rejects.toThrow('stopped');
  const current = audio.start(['audiofox:new'], vi.fn());
  await Promise.resolve();
  await previous;
  children[1].reply();
  await current;
  await vi.advanceTimersByTimeAsync(300);
  expect(children[0].kill).toHaveBeenCalledOnce();
  expect(children[1].kill).not.toHaveBeenCalled();
});

test('reports capture failures and unexpected helper exits', async () => {
  const audio = await import('./audiofox');
  const failed = expect(audio.start(['audiofox:missing'], vi.fn())).rejects.toThrow('missing');
  await Promise.resolve();
  children[0].reply(undefined, 'missing');
  await failed;
  const frames = vi.fn();
  const starting = audio.start(['audiofox:music'], frames);
  await Promise.resolve();
  children[1].reply();
  await starting;
  children[1].emit('exit', 1);
  expect(frames).toHaveBeenCalledWith(Buffer.alloc(0));
});

test('requires OS support for application capture', async () => {
  const { supported } = await import('./audiofox');
  expect(supported('linux', '6.12.0')).toBe(true);
  expect(supported('win32', '10.0.19045')).toBe(false);
  expect(supported('win32', '10.0.20348')).toBe(true);
  expect(supported('win32', 'unknown')).toBe(false);
  expect(supported('darwin', '23.1.0')).toBe(false);
  expect(supported('darwin', '23.2.0')).toBe(true);
});
