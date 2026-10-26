import { ShareMenu, type BrowserWindow } from 'electron';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { PickedFile } from '../../src/lib/platform/file-dialog-types';
import { writeDownload } from './downloads';

let pendingShare = Promise.resolve();

export async function shareFile(
  window: BrowserWindow,
  appDirectory: string,
  request: unknown
): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Native sharing is unavailable');
  const { name, bytes } = (request ?? {}) as Partial<PickedFile>;
  if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) {
    throw new Error('Invalid share file');
  }
  const share = pendingShare.then(async () => {
    const directory = join(appDirectory, 'outgoing-share');
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const path = await writeDownload(directory, name, bytes);
    // Sharing services can read the file after the menu closes.
    new ShareMenu({ filePaths: [path] }).popup({ window });
  });
  pendingShare = share.catch(() => {});
  return share;
}
