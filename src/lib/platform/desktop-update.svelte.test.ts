import { afterEach, expect, test, vi } from 'vitest';

import type { AvailableUpdate } from './updates';

afterEach(() => {
  vi.resetModules();
});

function pending(version: string, install: AvailableUpdate['install']): AvailableUpdate {
  return { version, notes: undefined, install };
}

test('keeps a pending update and stages it when installed', async () => {
  const { desktopUpdate, installPendingUpdate, setPendingUpdate } =
    await import('./desktop-update.svelte');
  expect(desktopUpdate.update).toBeNull();

  const seen: number[] = [];
  setPendingUpdate(
    pending('1.3.0', (onProgress) => {
      onProgress(40);
      seen.push((desktopUpdate.stage as { percent: number }).percent);
      return Promise.resolve();
    })
  );
  expect(desktopUpdate.update?.version).toBe('1.3.0');
  expect(desktopUpdate.stage).toEqual({ name: 'available' });

  await installPendingUpdate();
  expect(seen).toEqual([40]);
  expect(desktopUpdate.stage).toEqual({ name: 'staged' });
});

test('reports a failed install and resets the stage for a newer version', async () => {
  const { desktopUpdate, installPendingUpdate, setPendingUpdate } =
    await import('./desktop-update.svelte');
  setPendingUpdate(pending('1.3.0', () => Promise.reject(new Error('offline'))));

  await installPendingUpdate();
  expect(desktopUpdate.stage).toEqual({ name: 'failed', message: 'offline' });

  setPendingUpdate(pending('1.3.0', () => Promise.resolve()));
  expect(desktopUpdate.stage.name).toBe('failed');

  setPendingUpdate(pending('1.4.0', () => Promise.resolve()));
  expect(desktopUpdate.stage).toEqual({ name: 'available' });
});
