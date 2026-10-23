import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ invoke: vi.fn(), Channel: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => tauri);

import { startScreenAudioStream, stopScreenAudioStream } from './screen-audio-stream';

const track = {} as MediaStreamTrack;
let receive: (data: ArrayBuffer) => void;
const unsubscribe = vi.fn();
const start = vi.fn();
const stop = vi.fn();
const close = vi.fn();
const post = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  start.mockResolvedValue(undefined);
  stop.mockResolvedValue(undefined);
  close.mockResolvedValue(undefined);
  vi.stubGlobal('sableElectron', {
    platform: 'win32',
    startScreenAudioStream: start,
    stopScreenAudio: stop,
    onScreenAudioFrames: (callback: typeof receive) => {
      receive = callback;
      return unsubscribe;
    },
  });
  vi.stubGlobal(
    'AudioContext',
    class {
      audioWorklet = { addModule: vi.fn(() => Promise.resolve()) };
      close = close;
      resume = vi.fn(() => Promise.resolve());
    }
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { postMessage: post };
      connect = vi.fn();
    }
  );
  vi.stubGlobal(
    'MediaStreamAudioDestinationNode',
    class {
      stream = { getAudioTracks: () => [track] };
    }
  );
});

afterEach(async () => {
  await stopScreenAudioStream();
  vi.unstubAllGlobals();
});

test('passes Electron PCM to the worklet and cleans up on stop', async () => {
  const selection = { kind: 'apps' as const, include: ['mpv'] };
  expect(await startScreenAudioStream(selection)).toBe(track);
  expect(start).toHaveBeenCalledWith(selection);
  const samples = new Float32Array([0.25, -0.5]);
  receive(samples.buffer);
  expect(post).toHaveBeenCalledWith(samples, [samples.buffer]);
  expect(tauri.invoke).not.toHaveBeenCalled();
  expect(tauri.Channel).not.toHaveBeenCalled();

  await stopScreenAudioStream();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
});

test('cleans up when capture fails to start', async () => {
  const error = new Error('Windows refused capture');
  start.mockRejectedValueOnce(error);
  await expect(startScreenAudioStream({ kind: 'system', exclude: [] })).rejects.toBe(error);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
});

test('stops when capture ends', async () => {
  await startScreenAudioStream({ kind: 'system', exclude: [] });
  receive(new ArrayBuffer(0));
  await vi.waitFor(() => {
    expect(stop).toHaveBeenCalledOnce();
  });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
