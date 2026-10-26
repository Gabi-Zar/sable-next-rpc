import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { isTauri, type, invoke, write } = vi.hoisted(() => ({
  isTauri: vi.fn(),
  type: vi.fn(),
  invoke: vi.fn(),
  write: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri, invoke }));
vi.mock('@tauri-apps/plugin-os', () => ({ type }));

import { copyImage } from './clipboard';

const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
beforeEach(() => {
  vi.clearAllMocks();
  isTauri.mockReturnValue(false);
  type.mockReturnValue('android');
  invoke.mockResolvedValue(undefined);
  write.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { write } });
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

test('Android copies PNG bytes through the native command without WebView clipboard support', async () => {
  isTauri.mockReturnValue(true);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('ClipboardItem', undefined);
  await copyImage(Promise.resolve(png));
  expect(invoke).toHaveBeenCalledWith('copy_image_to_clipboard', { image: 'AQID' });
  expect(write).not.toHaveBeenCalled();
});

test('native copy failure propagates instead of falling back to the WebView', async () => {
  isTauri.mockReturnValue(true);
  invoke.mockRejectedValueOnce(new Error('clipboard unavailable'));
  await expect(copyImage(png)).rejects.toThrow('clipboard unavailable');
  expect(write).not.toHaveBeenCalled();
});

test('web copy passes the PNG promise to the clipboard within the user gesture', async () => {
  const pending = Promise.resolve(png);
  const copying = copyImage(pending);
  expect(write).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledWith([expect.objectContaining({ data: { 'image/png': pending } })]);
  await copying;
  expect(invoke).not.toHaveBeenCalled();
});

test('other Tauri platforms retain the existing browser image-copy behavior', async () => {
  isTauri.mockReturnValue(true);
  type.mockReturnValue('ios');
  await copyImage(png);
  expect(write).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});
