import { EventEmitter } from 'node:events';
import { beforeEach, expect, test, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const created = vi.hoisted(
  () =>
    [] as {
      options: Record<string, unknown>;
      webContents: EventEmitter & { setWindowOpenHandler: ReturnType<typeof vi.fn> };
      destroy: ReturnType<typeof vi.fn>;
    }[]
);

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    BrowserWindow: class extends EventEmitter {
      webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() });
      destroyed = false;
      destroy = vi.fn(() => {
        this.destroyed = true;
        this.emit('closed');
      });
      constructor(public options: Record<string, unknown>) {
        super();
        created.push(this);
      }
      isDestroyed() {
        return this.destroyed;
      }
      loadURL = vi.fn(() => Promise.resolve());
    },
  };
});

import { AuthWindows, matchesAuthCallback } from './auth-window';

beforeEach(() => {
  created.length = 0;
});

test.each([
  ['moe.sable.next:/login?code=code&state=state', 'moe.sable.next:/login', true],
  ['moe.sable.next:/room?code=code', 'moe.sable.next:/login', false],
  ['https://login?code=code', 'moe.sable.next:/login', false],
  [
    'moe.sable.next://login?sable_sso_state=other',
    'moe.sable.next://login?sable_sso_state=nonce',
    false,
  ],
  [
    'moe.sable.next://login?sable_sso_state=nonce&loginToken=token',
    'moe.sable.next://login?sable_sso_state=nonce',
    true,
  ],
])('checks the authentication redirect target %s', (candidate, expected, matches) => {
  expect(matchesAuthCallback(candidate, expected)).toBe(matches);
});

test.each(['will-navigate', 'will-redirect'])(
  'captures OAuth callbacks through %s and closes only that popup',
  async (event) => {
    const parent = new EventEmitter() as unknown as BrowserWindow;
    const callback = vi.fn();
    const windows = new AuthWindows(callback);
    await windows.open(parent, 'oauth', 'https://auth.example.org/', 'moe.sable.next:/login');
    await windows.open(parent, 'approval', 'https://auth.example.org/device');
    const preventDefault = vi.fn();
    created[0].webContents.emit(
      event,
      { preventDefault },
      'moe.sable.next:/login?code=code&state=state'
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledExactlyOnceWith('moe.sable.next:/login?code=code&state=state');
    expect(created[0].destroy).toHaveBeenCalledOnce();
    expect(created[1].destroy).not.toHaveBeenCalled();
    windows.close('approval');
    expect(created[1].destroy).toHaveBeenCalledOnce();
    expect(parent.listenerCount('closed')).toBe(0);
  }
);

test('disables Node, blocks file navigation and closes with the parent', async () => {
  const parent = new EventEmitter() as unknown as BrowserWindow;
  const windows = new AuthWindows(vi.fn());
  await windows.open(parent, 'approval', 'https://auth.example.org/device');
  expect(created[0].options.webPreferences).toEqual({
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  const preventDefault = vi.fn();
  created[0].webContents.emit('will-navigate', { preventDefault }, 'file:///etc/passwd');
  expect(preventDefault).toHaveBeenCalledOnce();
  parent.emit('closed');
  expect(created[0].destroy).toHaveBeenCalledOnce();
});

test.each(['javascript:alert(1)', 'file:///etc/passwd', 'invalid'])(
  'rejects invalid auth URL %s before creating a popup',
  async (url) => {
    const windows = new AuthWindows(vi.fn());
    await expect(windows.open({} as BrowserWindow, 'approval', url)).rejects.toThrow('HTTP');
    expect(created).toHaveLength(0);
  }
);
