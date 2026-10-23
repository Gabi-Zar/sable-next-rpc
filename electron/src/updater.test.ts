import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '2.0.0' },
  existsSync: vi.fn(() => true),
  setFeedURL: vi.fn(),
  handle: vi.fn<(channel: string, handler: (event: { senderFrame: object }) => unknown) => void>(),
  checkForUpdates: vi.fn(),
}));

vi.mock('electron', () => ({ app: mocks.app, ipcMain: { handle: mocks.handle } }));
vi.mock('electron-updater', () => ({ autoUpdater: mocks }));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));

import { registerUpdater, setUpdateChannel, supportsAutoUpdate } from './updater';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubGlobal('process', {
    ...process,
    platform: 'linux',
    resourcesPath: '/opt/Sable/resources',
  });
  vi.stubEnv('FLATPAK_ID', '');
  vi.stubEnv('APPIMAGE', '');
  mocks.app.isPackaged = true;
  mocks.existsSync.mockReturnValue(true);
});

test('AUR packages without updater metadata do not configure or check the Debian feed', async () => {
  mocks.existsSync.mockReturnValue(false);
  expect(supportsAutoUpdate()).toBe(false);
  setUpdateChannel('stable');
  expect(mocks.setFeedURL).not.toHaveBeenCalled();
  registerUpdater(() => true);
  const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'sable-update-check');
  expect(handler).toBeDefined();
  expect(await handler?.[1]({ senderFrame: {} })).toBeNull();
  expect(mocks.checkForUpdates).not.toHaveBeenCalled();
});

test('native deb and rpm packages retain their updater', () => {
  expect(supportsAutoUpdate()).toBe(true);
  expect(mocks.existsSync).toHaveBeenCalledWith('/opt/Sable/resources/app-update.yml');
});

test('AppImages retain updates without adjacent metadata', () => {
  mocks.existsSync.mockReturnValue(false);
  vi.stubEnv('APPIMAGE', '/home/user/Sable.AppImage');
  expect(supportsAutoUpdate()).toBe(true);
});

test('Flatpak and development builds do not offer self updates', () => {
  vi.stubEnv('FLATPAK_ID', 'moe.sable.client');
  expect(supportsAutoUpdate()).toBe(false);
  vi.stubEnv('FLATPAK_ID', '');
  mocks.app.isPackaged = false;
  expect(supportsAutoUpdate()).toBe(false);
});

test.each(['darwin', 'win32'])('%s retains updates without Linux metadata', (platform) => {
  vi.stubGlobal('process', { ...process, platform });
  mocks.existsSync.mockReturnValue(false);
  expect(supportsAutoUpdate()).toBe(true);
});

test('MAS builds do not configure or check for updates', async () => {
  vi.stubGlobal('process', { ...process, platform: 'darwin', mas: true });
  expect(supportsAutoUpdate()).toBe(false);
  setUpdateChannel('stable');
  expect(mocks.setFeedURL).not.toHaveBeenCalled();
  registerUpdater(() => true);
  const handler = mocks.handle.mock.calls.find(([channel]) => channel === 'sable-update-check');
  expect(handler).toBeDefined();
  expect(await handler?.[1]({ senderFrame: {} })).toBeNull();
  expect(mocks.checkForUpdates).not.toHaveBeenCalled();
});
