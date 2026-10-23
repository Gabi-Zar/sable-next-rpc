import { beforeEach, expect, test, vi } from 'vitest';

const native = vi.hoisted(() => ({
  startScreenAudio: vi.fn<(frames: (data: Buffer) => void) => void>(),
  stopScreenAudio: vi.fn(),
}));
vi.mock('node:module', () => ({ createRequire: () => () => native }));

import { start, stop } from './windows-screen-audio';

beforeEach(() => {
  stop();
  vi.clearAllMocks();
});

test('captures system audio and ignores frames after stop', () => {
  const receive = vi.fn();
  start({ kind: 'system', exclude: [] }, receive);
  expect(native.startScreenAudio).toHaveBeenCalledWith(expect.any(Function));
  const frames = native.startScreenAudio.mock.calls[0][0];
  const chunk = Buffer.alloc(3840);
  frames(chunk);
  expect(receive).toHaveBeenCalledWith(chunk);
  stop();
  frames(chunk);
  expect(receive).toHaveBeenCalledOnce();
  expect(native.stopScreenAudio).toHaveBeenCalled();
});

test('ignores frames from a replaced capture', () => {
  const previous = vi.fn();
  const current = vi.fn();
  start({ kind: 'system', exclude: [] }, previous);
  const previousFrames = native.startScreenAudio.mock.calls[0][0];
  start({ kind: 'system', exclude: [] }, current);
  previousFrames(Buffer.alloc(3840));
  expect(previous).not.toHaveBeenCalled();
  expect(native.startScreenAudio).toHaveBeenLastCalledWith(expect.any(Function));
  native.startScreenAudio.mock.calls[1][0](Buffer.alloc(3840));
  expect(current).toHaveBeenCalledOnce();
});

test.each([
  null,
  {},
  { kind: 'none' },
  { kind: 'apps', include: [] },
  { kind: 'apps', include: ['mpv', 'Firefox'] },
  { kind: 'apps', include: [1] },
])('rejects invalid selections: %j', (selection) => {
  expect(() => {
    start(selection, vi.fn());
  }).toThrow();
  expect(native.startScreenAudio).not.toHaveBeenCalled();
});
