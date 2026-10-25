import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const { copyImage, info, error } = vi.hoisted(() => ({
  copyImage: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('#lib/platform/clipboard.js', () => ({ copyImage }));
vi.mock('#lib/ui/toasts.svelte.js', () => ({ toasts: { info, error } }));

import { MediaViewerActions } from './media-viewer-actions';

const actions = new MediaViewerActions(
  () => ({ url: 'blob:image', item: undefined, fileName: 'image.png' }),
  () => ({ copied: 'copied', copyFailed: 'failed', saved: 'saved', saveFailed: 'save failed' })
);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(new Blob([new Uint8Array([1])], { type: 'image/png' })))
      )
  );
});
afterEach(() => vi.unstubAllGlobals());

test('copy success is shown only after the platform clipboard completes', async () => {
  const nativeCopy = Promise.withResolvers<undefined>();
  copyImage.mockReturnValueOnce(nativeCopy.promise);
  const copying = actions.copyImage();
  await vi.waitFor(() => {
    expect(copyImage).toHaveBeenCalledOnce();
  });
  expect(info).not.toHaveBeenCalled();
  expect(await copyImage.mock.calls[0][0]).toBeInstanceOf(Blob);
  nativeCopy.resolve(undefined);
  await copying;
  expect(info).toHaveBeenCalledWith('copied');
  expect(error).not.toHaveBeenCalled();
});

test('platform clipboard failures show an error without reporting success', async () => {
  copyImage.mockRejectedValueOnce(new Error('native write failed'));
  await actions.copyImage();
  expect(error).toHaveBeenCalledWith('failed');
  expect(info).not.toHaveBeenCalled();
});
