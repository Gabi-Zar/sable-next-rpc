// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

vi.mock('#lib/platform/files.js', () => ({
  saveUrl: vi.fn(),
  savesNatively: vi.fn(() => false),
}));
const toasts = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('#lib/ui/toasts.svelte.js', () => ({ toasts }));

import { saveUrl, savesNatively } from '#lib/platform/files.js';

import { downloadUrl } from './download.js';

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(savesNatively).mockReturnValue(false);
});

test('a browser download shows no toast', async () => {
  vi.mocked(saveUrl).mockResolvedValue('saved');

  await downloadUrl('blob:clip', 'clip.mp4');

  expect(saveUrl).toHaveBeenCalledWith('blob:clip', 'clip.mp4');
  expect(toasts.info).not.toHaveBeenCalled();
  expect(toasts.error).not.toHaveBeenCalled();
});

test.each([
  { outcome: 'saved' as const, info: 1, error: 0 },
  { outcome: 'failed' as const, info: 0, error: 1 },
  { outcome: 'cancelled' as const, info: 0, error: 0 },
])('the apps save natively and report a $outcome save', async ({ outcome, info, error }) => {
  vi.mocked(savesNatively).mockReturnValue(true);
  vi.mocked(saveUrl).mockResolvedValue(outcome);

  await downloadUrl('blob:clip', 'clip.mp4');

  expect(saveUrl).toHaveBeenCalledWith('blob:clip', 'clip.mp4');
  expect(toasts.info).toHaveBeenCalledTimes(info);
  expect(toasts.error).toHaveBeenCalledTimes(error);
});
