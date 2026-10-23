// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  invoke.mockReset();
  localStorage.clear();
});

test('an existing native session restores without waiting for a held WebView migration lock', async () => {
  const request = vi.fn(() => new Promise<void>(() => {}));
  vi.stubGlobal('navigator', { locks: { request } });
  invoke.mockResolvedValue(true);
  localStorage.setItem('matrixSessions', 'unreadable legacy credentials');

  const { migrateV1 } = await import('./migration.js');
  await migrateV1();

  expect(invoke).toHaveBeenCalledExactlyOnceWith('v1_migration_complete');
  expect(request).not.toHaveBeenCalled();
  expect(localStorage.getItem('matrixSessions')).toBe('unreadable legacy credentials');
});

test('an incomplete native migration still checks its status under the migration lock', async () => {
  const request = vi.fn(async (_name: string, callback: () => Promise<void>) => callback());
  vi.stubGlobal('navigator', { locks: { request } });
  invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  const { migrateV1 } = await import('./migration.js');
  await migrateV1();

  expect(request).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledTimes(2);
});
