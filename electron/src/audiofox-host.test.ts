import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
const native = vi.hoisted(() => ({
  startAudiofox: vi.fn(),
  audiofoxApps: vi.fn(() => []),
  stopAudiofox: vi.fn(),
}));
vi.mock('node:module', () => ({ createRequire: () => () => native }));
afterEach(() => vi.unstubAllGlobals());

test('bounds outgoing PCM and preserves the parent PID for process filtering', async () => {
  const port = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
  vi.stubGlobal('__dirname', '/audio');
  vi.stubGlobal('process', { ...process, parentPort: port });
  await import('./audiofox-host');
  port.emit('message', {
    data: { command: 'start', id: 1, rootPid: 42, include: ['audiofox:music'] },
  });
  expect(native.startAudiofox).toHaveBeenCalledWith(['audiofox:music'], 42, expect.any(Function));
  const receive = native.startAudiofox.mock.calls[0][2] as (data: Buffer) => void;
  port.postMessage.mockClear();
  receive(Buffer.from([1]));
  receive(Buffer.from([2]));
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  port.emit('message', { data: { command: 'ack' } });
  receive(Buffer.from([3]));
  expect(port.postMessage).toHaveBeenCalledTimes(2);
  receive(Buffer.alloc(0));
  expect(port.postMessage).toHaveBeenCalledTimes(3);
});
