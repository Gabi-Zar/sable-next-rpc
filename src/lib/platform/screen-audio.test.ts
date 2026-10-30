// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const stream = vi.hoisted(() => ({
  startScreenAudioStream: vi.fn(() => Promise.resolve({} as MediaStreamTrack)),
  stopScreenAudioStream: vi.fn(() => Promise.resolve()),
}));
vi.mock('./screen-audio-stream', () => stream);

import {
  captureScreenAudio,
  lastScreenAudioChoice,
  screenAudioPicksMany,
  screenAudioSupported,
  stopScreenAudio,
  listScreenAudioApps,
  screenAudioAppLabel,
  screenAudioSystemSupported,
  screenAudioCanExclude,
  unmuteScreenAudio,
} from './screen-audio';

beforeEach(() => {
  stream.startScreenAudioStream.mockClear();
  stream.stopScreenAudioStream.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

test('preserves Electron backend status and stream identities', async () => {
  const listing = {
    status: 'pipewire-pulse-missing',
    apps: [{ id: 'stream-1', label: 'Firefox (Music)' }],
  };
  const unmute = vi.fn(() => Promise.resolve());
  vi.stubGlobal('sableElectron', {
    platform: 'linux',
    screenAudioApps: () => Promise.resolve(listing),
    unmuteScreenAudio: unmute,
  });
  expect(await listScreenAudioApps()).toBe(listing);
  await unmuteScreenAudio();
  expect(unmute).toHaveBeenCalledOnce();
});

test('labels remembered PipeWire streams and preserves legacy app names', () => {
  expect(screenAudioAppLabel('audiofox:music')).toBe('music');
  const id =
    'pipewire:' +
    JSON.stringify({
      'application.name': 'Firefox',
      'media.name': 'Music',
      'application.process.id': '10',
    });
  expect(screenAudioAppLabel(id)).toBe('Firefox (Music · 10)');
  expect(screenAudioAppLabel('Firefox')).toBe('Firefox');
});

test('clears legacy application selections when switching to Audiofox', () => {
  vi.stubGlobal('sableElectron', { platform: 'linux', screenAudioAvailable: true });
  localStorage.setItem(
    'sable-screen-audio-choice',
    JSON.stringify({
      kind: 'apps',
      include: ['mpv', 'pipewire:{}', 'audiofox:music'],
      workaround: true,
    })
  );
  try {
    expect(lastScreenAudioChoice()).toEqual({ kind: 'apps', include: ['audiofox:music'] });
  } finally {
    localStorage.removeItem('sable-screen-audio-choice');
  }
});

test('Electron streams application audio and also cleans up system capture', async () => {
  const start = vi.fn();
  const stop = vi.fn(() => Promise.resolve());
  vi.stubGlobal('sableElectron', {
    platform: 'linux',
    screenAudioAvailable: true,
    startScreenAudio: start,
    stopScreenAudio: stop,
  });
  await captureScreenAudio({ kind: 'apps', include: ['audiofox:music'] });
  expect(stream.startScreenAudioStream).toHaveBeenCalledWith({
    kind: 'apps',
    include: ['audiofox:music'],
  });
  expect(start).not.toHaveBeenCalled();
  await stopScreenAudio();
  expect(stream.stopScreenAudioStream).toHaveBeenCalledOnce();
  expect(stop).toHaveBeenCalledOnce();
});

test('Electron supports macOS application capture and Windows multi-app selection', () => {
  vi.stubGlobal('sableElectron', { platform: 'darwin', screenAudioAvailable: true });
  expect(screenAudioSupported()).toBe(true);
  expect(screenAudioSystemSupported()).toBe(false);
  expect(screenAudioPicksMany()).toBe(true);
  vi.stubGlobal('sableElectron', { platform: 'win32', screenAudioAvailable: true });
  expect(screenAudioSystemSupported()).toBe(true);
  expect(screenAudioCanExclude()).toBe(false);
  expect(screenAudioPicksMany()).toBe(true);
});

test('preserves the capture error when cleanup also fails', async () => {
  const error = new DOMException('Permission denied', 'NotAllowedError');
  const cleanupError = new Error('cleanup failed');
  const stop = vi.fn(() => Promise.reject(cleanupError));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('sableElectron', {
    platform: 'linux',
    startScreenAudio: () => Promise.reject(error),
    stopScreenAudio: stop,
  });
  try {
    await expect(captureScreenAudio({ kind: 'system', exclude: [] })).rejects.toBe(error);
    expect(warn).toHaveBeenCalledWith('[sable screen audio] cleanup failed', cleanupError);
    expect(stop).toHaveBeenCalledOnce();
  } finally {
    warn.mockRestore();
  }
});

test('Windows Electron uses native audio on supported builds', async () => {
  const bridge = {
    platform: 'win32',
    screenAudioAvailable: true,
    stopScreenAudio: vi.fn(() => Promise.resolve()),
  };
  vi.stubGlobal('sableElectron', bridge);
  expect(screenAudioSupported()).toBe(true);
  expect(screenAudioPicksMany()).toBe(true);
  const selection = { kind: 'apps' as const, include: ['mpv'] };
  await captureScreenAudio(selection);
  expect(stream.startScreenAudioStream).toHaveBeenCalledWith(selection);
  await stopScreenAudio();
  expect(stream.stopScreenAudioStream).toHaveBeenCalledOnce();

  bridge.screenAudioAvailable = false;
  expect(screenAudioSupported()).toBe(false);
});
