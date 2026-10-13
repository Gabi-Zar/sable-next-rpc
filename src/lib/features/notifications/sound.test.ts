// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let playNotificationSound: typeof import('./sound').playNotificationSound;
let start: ReturnType<typeof vi.fn>;
let gains: { gain: { value: number } }[];

class MockAudioContext {
  state: AudioContextState = 'running';
  destination = {} as AudioDestinationNode;
  decodeAudioData = vi.fn<() => Promise<AudioBuffer>>().mockResolvedValue({} as AudioBuffer);
  resume = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  createBufferSource = vi.fn<() => AudioBufferSourceNode>(
    () =>
      ({
        addEventListener: vi.fn(),
        buffer: null,
        connect: vi.fn((node: AudioNode) => node),
        start,
      }) as unknown as AudioBufferSourceNode
  );
  createGain = vi.fn<() => GainNode>(() => {
    const node = { gain: { value: 1 }, connect: vi.fn((next: AudioNode) => next) };
    gains.push(node);
    return node as unknown as GainNode;
  });
}

const nativeAudioContext = globalThis.AudioContext;
const nativeFetch = globalThis.fetch;

beforeEach(async () => {
  vi.resetModules();
  start = vi.fn();
  gains = [];
  globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
  globalThis.fetch = vi.fn<() => Promise<Response>>().mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as Response);
  ({ playNotificationSound } = await import('./sound'));
});

afterEach(() => {
  globalThis.AudioContext = nativeAudioContext;
  globalThis.fetch = nativeFetch;
});

test('plays at the chosen volume', async () => {
  const { preferences } = await import('#lib/settings/preferences.svelte.js');
  preferences.soundsNotificationVolume = 0.35;

  await playNotificationSound('notification');

  expect(gains[0]?.gain.value).toBe(0.35);
});

test('plays the notification sound', async () => {
  await playNotificationSound('notification');

  expect(fetch).toHaveBeenCalledWith('/sound/msg.webm');
  expect(start).toHaveBeenCalledOnce();
});

test('decodes each sound once', async () => {
  const { playSound } = await import('./sound');
  await playSound('call_join');
  await playSound('call_join');

  expect(fetch).toHaveBeenCalledOnce();
  expect(start).toHaveBeenCalledTimes(2);
});

test('loads the sound again after a failed fetch', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));

  await expect(playNotificationSound('notification')).rejects.toThrow('offline');
  await playNotificationSound('notification');

  expect(fetch).toHaveBeenCalledTimes(2);
  expect(start).toHaveBeenCalledOnce();
});
