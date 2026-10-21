import { EventEmitter } from 'node:events';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quit: vi.fn(),
  fail: false,
  menu: [] as MenuItemConstructorOptions[],
}));

vi.mock('electron', () => ({
  app: { quit: mocks.quit },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  Menu: {
    buildFromTemplate: (items: MenuItemConstructorOptions[]) => {
      mocks.menu = items;
      return items;
    },
  },
  Tray: class extends EventEmitter {
    destroy = vi.fn();
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    constructor() {
      super();
      if (mocks.fail) throw new Error('Tray unavailable');
      trayEvents.push(this);
    }
  },
}));

const trayEvents: (EventEmitter & { destroy: ReturnType<typeof vi.fn> })[] = [];

import { DesktopTray, hideToTray } from './tray';

function setup(platform: NodeJS.Platform = 'win32') {
  let visible = true;
  let minimized = false;
  const window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    show: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
    restore: vi.fn(() => {
      minimized = false;
    }),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
  const tray = new DesktopTray('/icon.ico', () => window as unknown as BrowserWindow, platform);
  return {
    tray,
    window,
    minimize: () => {
      minimized = true;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  trayEvents.length = 0;
  mocks.fail = false;
  mocks.menu = [];
});

test('Windows double-click hides and restores, while single click does not toggle', () => {
  const { tray, window, minimize } = setup();
  expect(tray.update(true)).toBe(true);
  trayEvents[0].emit('click');
  expect(window.hide).not.toHaveBeenCalled();
  trayEvents[0].emit('double-click');
  expect(window.hide).toHaveBeenCalledOnce();
  expect(window.webContents.send).toHaveBeenCalledWith('sable-window-hidden-to-tray');
  trayEvents[0].emit('double-click');
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.focus).toHaveBeenCalledOnce();
  minimize();
  trayEvents[0].emit('double-click');
  expect(window.restore).toHaveBeenCalledOnce();
  expect(window.isVisible()).toBe(true);
});

test('the menu restores a hidden window and Quit exits the app', () => {
  const { tray, window } = setup();
  tray.update(true);
  hideToTray(window as unknown as BrowserWindow);
  mocks.menu[0].click?.(undefined as never, undefined, undefined as never);
  expect(window.show).toHaveBeenCalledOnce();
  mocks.menu[2].click?.(undefined as never, undefined, undefined as never);
  expect(mocks.quit).toHaveBeenCalledOnce();
});

test('disabling the tray reveals a hidden window, and re-enabling creates one icon', () => {
  const { tray, window } = setup();
  tray.update(true);
  tray.update(true);
  expect(trayEvents).toHaveLength(1);
  hideToTray(window as unknown as BrowserWindow);
  expect(tray.update(false)).toBe(false);
  expect(tray.available).toBe(false);
  expect(trayEvents[0].destroy).toHaveBeenCalledOnce();
  expect(window.show).toHaveBeenCalledOnce();
  expect(tray.update(true)).toBe(true);
  expect(trayEvents).toHaveLength(2);
  hideToTray(window as unknown as BrowserWindow);
  tray.destroy();
  expect(tray.available).toBe(false);
  expect(window.isVisible()).toBe(false);
});

test('tray creation failure leaves close/minimize available', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.fail = true;
  const { tray } = setup();
  expect(tray.update(true)).toBe(false);
  expect(tray.available).toBe(false);
  error.mockRestore();
});

test('Linux retains click-to-show behavior', () => {
  const { tray, window } = setup('linux');
  tray.update(true);
  trayEvents[0].emit('click');
  expect(window.show).toHaveBeenCalledOnce();
  expect(window.hide).not.toHaveBeenCalled();
});
