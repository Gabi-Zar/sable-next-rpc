import { isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';

import { isNativeMobile } from './os';
import { electronBridge, isElectron } from './electron';

export type WindowEdge =
  | 'North'
  | 'NorthEast'
  | 'East'
  | 'SouthEast'
  | 'South'
  | 'SouthWest'
  | 'West'
  | 'NorthWest';

export type TitleBarKind = 'desktop' | 'mac';

export interface DesktopWindowSettings {
  closeToTray: boolean;
  minimizeToTray: boolean;
  showSystemTrayIcon: boolean;
  useCustomTitleBar: boolean;
  smoothScrolling: boolean;
}

export interface DesktopWindowState {
  trayAvailable: boolean;
}

export function supportsDesktopWindow(): boolean {
  return isTauri() && !isNativeMobile();
}

export function supportsCustomTitleBar(): boolean {
  return supportsDesktopWindow() || isElectron();
}

function desktopOs(): 'macos' | 'windows' | 'linux' | null {
  if (isElectron()) {
    const platform = electronBridge()?.platform;
    return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux';
  }
  return supportsDesktopWindow() ? (osType() as 'macos' | 'windows' | 'linux') : null;
}

export function supportsTray(): boolean {
  if (isElectron()) return electronBridge()?.platform === 'linux';
  return supportsDesktopWindow() && osType() !== 'macos';
}

export function supportsSmoothScrollingToggle(): boolean {
  return isElectron() || (supportsDesktopWindow() && osType() === 'linux');
}

export function customTitleBarDefault(): boolean {
  return desktopOs() === 'windows';
}

export function titleBarKind(useCustomTitleBar: boolean): TitleBarKind | null {
  if (!useCustomTitleBar || !supportsCustomTitleBar()) return null;

  return desktopOs() === 'macos' ? 'mac' : 'desktop';
}

export async function applyDesktopWindowSettings(
  settings: DesktopWindowSettings
): Promise<DesktopWindowState | null> {
  if (isElectron()) return electronBridge()?.applyWindowSettings(settings) ?? null;
  if (!supportsDesktopWindow()) return null;

  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DesktopWindowState>('apply_desktop_window_settings', { settings });
}

async function currentWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

export async function minimizeWindow(): Promise<void> {
  if (isElectron()) return electronBridge()?.minimizeWindow();
  await (await currentWindow()).minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (isElectron()) return electronBridge()?.toggleMaximizeWindow();
  await (await currentWindow()).toggleMaximize();
}

export async function setWindowFullscreen(fullscreen: boolean): Promise<void> {
  await (await currentWindow()).setFullscreen(fullscreen);
}

export async function closeWindow(): Promise<void> {
  if (isElectron()) return electronBridge()?.closeWindow();
  await (await currentWindow()).close();
}

export async function quitApp(): Promise<void> {
  const { exit } = await import('@tauri-apps/plugin-process');
  await exit(0);
}

export async function startWindowResize(edge: WindowEdge): Promise<void> {
  await (await currentWindow()).startResizeDragging(edge);
}

export function supportsWindowResizeHandles(): boolean {
  return supportsDesktopWindow();
}

export function supportsSnapLayouts(): boolean {
  return supportsDesktopWindow() && osType() === 'windows';
}

async function snapLayouts(command: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command);
}

export const showSnapLayouts = (): Promise<void> => snapLayouts('show_snap_layouts');
export const releaseSnapLayouts = (): Promise<void> => snapLayouts('release_snap_layouts');
export const dismissSnapLayouts = (): Promise<void> => snapLayouts('dismiss_snap_layouts');

const MAXIMIZE_SETTLE_MS = 150;

export async function watchMaximized(onChange: (maximized: boolean) => void): Promise<() => void> {
  const electron = electronBridge();
  if (electron) {
    const stop = electron.onWindowMaximized(onChange);
    onChange(await electron.isWindowMaximized());
    return stop;
  }

  const window = await currentWindow();
  onChange(await window.isMaximized());

  let settle: ReturnType<typeof setTimeout> | undefined;
  const unlisten = await window.onResized(() => {
    void window.isMaximized().then(onChange);
    clearTimeout(settle);
    settle = setTimeout(() => void window.isMaximized().then(onChange), MAXIMIZE_SETTLE_MS);
  });

  return () => {
    clearTimeout(settle);
    unlisten();
  };
}

export async function watchWindowFocus(onChange: (focused: boolean) => void): Promise<() => void> {
  if (!supportsDesktopWindow()) return () => {};
  onChange(false);
  const window = await currentWindow();
  const focus = { changed: false };
  const unlisten = await window.onFocusChanged((event) => {
    focus.changed = true;
    onChange(event.payload);
  });
  try {
    const [focused, minimized, visible] = await Promise.all([
      window.isFocused(),
      window.isMinimized(),
      window.isVisible(),
    ]);
    if (!focus.changed) onChange(focused && !minimized && visible);
  } catch (error) {
    unlisten();
    throw error;
  }
  return unlisten;
}

export async function watchHiddenToTray(onHidden: () => void): Promise<() => void> {
  if (!supportsDesktopWindow()) return () => {};

  const { listen } = await import('@tauri-apps/api/event');
  return listen('window-hidden-to-tray', () => {
    onHidden();
  });
}
