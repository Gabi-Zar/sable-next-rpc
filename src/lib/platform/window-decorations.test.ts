import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const native = vi.hoisted(() => ({
  isTauri: true,
  focusChanged: null as ((event: { payload: boolean }) => void) | null,
  isFocused: vi.fn<() => Promise<boolean>>(),
  isMinimized: vi.fn<() => Promise<boolean>>(),
  isVisible: vi.fn<() => Promise<boolean>>(),
  unlisten: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => native.isTauri }));
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFocused: native.isFocused,
    isMinimized: native.isMinimized,
    isVisible: native.isVisible,
    onFocusChanged: (callback: (event: { payload: boolean }) => void) => {
      native.focusChanged = callback;
      return Promise.resolve(native.unlisten);
    },
  }),
}));

import {
  customTitleBarDefault,
  supportsTray,
  titleBarKind,
  watchMaximized,
  watchWindowFocus,
  watchHiddenToTray,
} from './window-decorations.js';

beforeEach(() => {
  native.isTauri = true;
  native.focusChanged = null;
  native.unlisten.mockReset();
  native.isFocused.mockReset().mockResolvedValue(true);
  native.isMinimized.mockReset().mockResolvedValue(false);
  native.isVisible.mockReset().mockResolvedValue(true);
});

test.each([
  { focused: false, minimized: false, visible: true },
  { focused: true, minimized: true, visible: true },
  { focused: true, minimized: false, visible: false },
])('starts inactive for a background window: %j', async ({ focused, minimized, visible }) => {
  native.isFocused.mockResolvedValue(focused);
  native.isMinimized.mockResolvedValue(minimized);
  native.isVisible.mockResolvedValue(visible);
  const changed = vi.fn();
  const stop = await watchWindowFocus(changed);

  expect(changed).toHaveBeenCalled();
  expect(changed.mock.calls.every(([active]) => active === false)).toBe(true);
  native.focusChanged?.({ payload: true });
  expect(changed).toHaveBeenLastCalledWith(true);
  stop();
  expect(native.unlisten).toHaveBeenCalledOnce();
});

test('initial focus query cannot overwrite a newer blur event', async () => {
  let resolve!: (focused: boolean) => void;
  native.isFocused.mockImplementation(
    () =>
      new Promise<boolean>((next) => {
        resolve = next;
      })
  );
  const changed = vi.fn();
  const watching = watchWindowFocus(changed);
  await vi.waitFor(() => {
    expect(native.isFocused).toHaveBeenCalled();
  });

  native.focusChanged?.({ payload: false });
  resolve(true);
  const stop = await watching;

  expect(changed).toHaveBeenLastCalledWith(false);
  stop();
});

test('does not watch a native window in the browser', async () => {
  native.isTauri = false;
  const changed = vi.fn();
  const stop = await watchWindowFocus(changed);

  expect(changed).not.toHaveBeenCalled();
  expect(native.isFocused).not.toHaveBeenCalled();
  stop();
});

test('reads the initial foreground focus and follows later blur events', async () => {
  const changed = vi.fn();
  const stop = await watchWindowFocus(changed);

  expect(changed).toHaveBeenLastCalledWith(true);
  native.focusChanged?.({ payload: false });
  expect(changed).toHaveBeenLastCalledWith(false);
  stop();
});

test('removes the listener if the initial window query fails', async () => {
  native.isFocused.mockRejectedValue(new Error('window unavailable'));

  await expect(watchWindowFocus(vi.fn())).rejects.toThrow('window unavailable');
  expect(native.unlisten).toHaveBeenCalledOnce();
});

function installElectron(platform: string, maximized = false) {
  const unsubscribe = vi.fn();
  (globalThis as { sableElectron?: unknown }).sableElectron = {
    platform,
    isWindowMaximized: () => Promise.resolve(maximized),
    onWindowMaximized: () => unsubscribe,
  };
  return unsubscribe;
}

afterEach(() => {
  delete (globalThis as { sableElectron?: unknown }).sableElectron;
});

test.each([
  ['darwin', 'mac'],
  ['win32', 'desktop'],
  ['linux', 'desktop'],
])('Electron on %s draws the %s title bar', (platform, kind) => {
  native.isTauri = false;
  installElectron(platform);

  expect(titleBarKind(true)).toBe(kind);
  expect(titleBarKind(false)).toBeNull();
});

test('Electron defaults to the custom title bar only on Windows', () => {
  native.isTauri = false;
  installElectron('win32');
  expect(customTitleBarDefault()).toBe(true);
  installElectron('linux');
  expect(customTitleBarDefault()).toBe(false);
});

test('an Electron window reports its maximised state and stops listening', async () => {
  native.isTauri = false;
  const unsubscribe = installElectron('linux', true);
  const changed = vi.fn();

  const stop = await watchMaximized(changed);
  stop();

  expect(changed).toHaveBeenCalledWith(true);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test.each([
  ['win32', true],
  ['linux', true],
  ['darwin', false],
])('Electron tray settings are available on %s: %s', (platform, supported) => {
  native.isTauri = false;
  installElectron(platform);
  expect(supportsTray()).toBe(supported);
});

test('Electron hidden-to-tray notifications can be subscribed and removed', async () => {
  native.isTauri = false;
  const unsubscribe = vi.fn();
  const onWindowHiddenToTray = vi.fn().mockReturnValue(unsubscribe);
  vi.stubGlobal('sableElectron', { platform: 'win32', onWindowHiddenToTray });
  const hidden = vi.fn();
  const stop = await watchHiddenToTray(hidden);
  expect(onWindowHiddenToTray).toHaveBeenCalledWith(hidden);
  stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
