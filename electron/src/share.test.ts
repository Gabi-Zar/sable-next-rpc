import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest';

const { menu, popup } = vi.hoisted(() => ({ menu: vi.fn(), popup: vi.fn() }));
vi.mock('electron', () => ({
  ShareMenu: class {
    popup = popup;
    constructor(item: unknown) {
      menu(item);
    }
  },
}));

import { shareFile } from './share';

const window = {} as BrowserWindow;
const image = { name: 'image.png', bytes: new Uint8Array([1, 2, 3]) };
let directory: string;

function usePlatform(platform: NodeJS.Platform): void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  onTestFinished(() => {
    Object.defineProperty(process, 'platform', { value: original });
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sable-share-test-'));
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

test('macOS shares a readable file through the native menu', async () => {
  usePlatform('darwin');
  await shareFile(window, directory, image);
  const { filePaths } = menu.mock.calls[0][0] as { filePaths: string[] };
  expect(await readFile(filePaths[0])).toEqual(Buffer.from(image.bytes));
  expect(popup).toHaveBeenCalledWith({ window });
});

test('a new share replaces the previous file without touching other app data', async () => {
  usePlatform('darwin');
  await writeFile(join(directory, 'settings.json'), '{}');
  await shareFile(window, directory, image);
  await shareFile(window, directory, { ...image, name: 'latest.png' });
  expect(await readdir(join(directory, 'outgoing-share'))).toEqual(['latest.png']);
  expect(await readdir(directory)).toEqual(['outgoing-share', 'settings.json']);
  expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe('{}');
});

test('overlapping requests keep only the latest shared file', async () => {
  usePlatform('darwin');
  await Promise.all([
    shareFile(window, directory, image),
    shareFile(window, directory, { ...image, name: 'latest.png' }),
  ]);
  expect(await readdir(join(directory, 'outgoing-share'))).toEqual(['latest.png']);
});

test('an invalid filename does not prevent the next share', async () => {
  usePlatform('darwin');
  await expect(shareFile(window, directory, { ...image, name: '../escape' })).rejects.toThrow();
  await shareFile(window, directory, image);
  expect(menu).toHaveBeenCalledOnce();
});

test.each(['win32', 'linux'] as const)('%s rejects unavailable native sharing', async (os) => {
  usePlatform(os);
  await expect(shareFile(window, directory, image)).rejects.toThrow();
  expect(menu).not.toHaveBeenCalled();
});
