// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';

import { preferences, setPreference } from '#lib/settings/preferences.svelte.js';

import { trackZoomShortcuts } from './zoom-shortcuts';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/plugin-os', () => ({ type: vi.fn() }));

let stop = (): void => {};

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(osType).mockReturnValue('linux');
  setPreference('pageZoom', 1);
  setPreference('zoomShortcuts', true);
});

afterEach(() => {
  stop();
  vi.resetAllMocks();
});

function press(key: string, init: KeyboardEventInit = { ctrlKey: true }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function scroll(deltaY: number, deltaMode = 0): WheelEvent {
  const event = new WheelEvent('wheel', { deltaY, deltaMode, cancelable: true });
  // happy-dom drops modifier keys from `WheelEventInit`.
  Object.defineProperty(event, 'ctrlKey', { value: true });
  window.dispatchEvent(event);
  return event;
}

test('ctrl with +, - and 0 steps and resets the interface scale', () => {
  stop = trackZoomShortcuts();

  expect(press('=').defaultPrevented).toBe(true);
  press('+', { ctrlKey: true, shiftKey: true });
  expect(preferences.pageZoom).toBe(1.2);
  press('-');
  expect(preferences.pageZoom).toBe(1.1);
  press('0');
  expect(preferences.pageZoom).toBe(1);
});

test('the scale stays within the setting range', () => {
  stop = trackZoomShortcuts();

  for (let i = 0; i < 10; i++) press('-');
  expect(preferences.pageZoom).toBe(0.75);
});

test('ctrl and the wheel zoom one step per notch', async () => {
  stop = trackZoomShortcuts();
  // `on` attaches wheel listeners on the next microtask.
  await Promise.resolve();

  expect(scroll(-40).defaultPrevented).toBe(true);
  expect(preferences.pageZoom).toBe(1);
  scroll(-60);
  expect(preferences.pageZoom).toBe(1.1);
  scroll(100);
  expect(preferences.pageZoom).toBe(1);
});

test('ctrl-wheel accepts line deltas', async () => {
  stop = trackZoomShortcuts();
  await Promise.resolve();

  scroll(-7, 1);
  expect(preferences.pageZoom).toBe(1.1);
});

test('turned off, the keys and wheel are still kept from the webview', async () => {
  setPreference('zoomShortcuts', false);
  stop = trackZoomShortcuts();
  await Promise.resolve();

  expect(press('=').defaultPrevented).toBe(true);
  expect(scroll(-100).defaultPrevented).toBe(true);
  expect(preferences.pageZoom).toBe(1);
});

test('macOS uses cmd for the keys', () => {
  vi.mocked(osType).mockReturnValue('macos');
  stop = trackZoomShortcuts();

  expect(press('=').defaultPrevented).toBe(false);
  press('=', { metaKey: true });
  expect(preferences.pageZoom).toBe(1.1);
});

test('there are no zoom shortcuts on the web', () => {
  vi.mocked(isTauri).mockReturnValue(false);
  stop = trackZoomShortcuts();

  expect(press('=').defaultPrevented).toBe(false);
  expect(preferences.pageZoom).toBe(1);
});
