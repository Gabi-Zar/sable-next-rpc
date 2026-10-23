// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { ScreenAudioListing } from '#lib/platform/screen-audio-types.js';

const platform = vi.hoisted(() => ({
  listScreenAudioApps: vi.fn<() => Promise<string[]>>(),
  lastScreenAudioChoice: vi.fn(() => ({ kind: 'none' as const })),
  screenAudioPicksMany: vi.fn(() => true),
  screenAudioSystemSupported: vi.fn(() => true),
  screenAudioCanExclude: vi.fn(() => true),
  screenAudioAppLabel: (id: string) => id,
  status: 'available' as ScreenAudioListing['status'],
  labels: {} as Record<string, string>,
}));
vi.mock('#lib/platform/screen-audio.js', () => ({
  ...platform,
  listScreenAudioApps: async () => ({
    status: platform.status,
    apps: (await platform.listScreenAudioApps()).map((id) => ({
      id,
      label: platform.labels[id] ?? id,
    })),
  }),
}));

import ScreenShareAudioDialog from './ScreenShareAudioDialog.svelte';

afterEach(() => {
  platform.listScreenAudioApps.mockReset();
  platform.screenAudioPicksMany.mockReturnValue(true);
  platform.screenAudioSystemSupported.mockReturnValue(true);
  platform.screenAudioCanExclude.mockReturnValue(true);
  platform.status = 'available';
  platform.labels = {};
  vi.unstubAllGlobals();
});

function open() {
  const onShare = vi.fn();
  const onCancel = vi.fn();
  render(ScreenShareAudioDialog, { onShare, onCancel });
  return { onShare, onCancel, user: userEvent.setup() };
}

test('omits system capture when only application capture is supported', () => {
  platform.screenAudioSystemSupported.mockReturnValue(false);
  open();
  expect(screen.queryByRole('radio', { name: /Every app/ })).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Chosen apps/ })).toBeInTheDocument();
});

test('shares no audio unless another source is picked', async () => {
  const { onShare, user } = open();

  await user.click(await screen.findByRole('button', { name: 'Share' }));

  expect(onShare).toHaveBeenCalledWith({ kind: 'none' });
  expect(platform.listScreenAudioApps).not.toHaveBeenCalled();
});

test('shares every app except the ones left out', async () => {
  platform.listScreenAudioApps.mockResolvedValue(['Firefox', 'Spotify']);
  const { onShare, user } = open();

  await user.click(await screen.findByRole('radio', { name: /Every app/ }));
  await user.click(await screen.findByRole('checkbox', { name: 'Spotify' }));
  await user.click(screen.getByRole('button', { name: 'Share' }));

  expect(onShare).toHaveBeenCalledWith({ kind: 'system', exclude: ['Spotify'] });
});

test('needs at least one chosen app before sharing', async () => {
  platform.listScreenAudioApps.mockResolvedValue(['mpv']);
  const { onShare, user } = open();

  await user.click(await screen.findByRole('radio', { name: /Chosen apps/ }));
  expect(await screen.findByRole('button', { name: 'Share' })).toBeDisabled();

  await user.click(await screen.findByRole('checkbox', { name: 'mpv' }));
  await user.click(screen.getByRole('button', { name: 'Share' }));

  expect(onShare).toHaveBeenCalledWith({ kind: 'apps', include: ['mpv'] });
});

test('says so when nothing is playing, and lists apps after a refresh', async () => {
  platform.listScreenAudioApps.mockResolvedValueOnce([]).mockResolvedValueOnce(['mpv']);
  const { user } = open();

  await user.click(await screen.findByRole('radio', { name: /Every app/ }));
  expect(await screen.findByText(/No app is playing sound/)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Refresh the list of apps' }));

  expect(await screen.findByRole('checkbox', { name: 'mpv' })).toBeInTheDocument();
  expect(platform.listScreenAudioApps).toHaveBeenCalledTimes(2);
});

test('cancelling shares nothing', async () => {
  const { onShare, onCancel, user } = open();

  await user.click(await screen.findByRole('button', { name: 'Cancel' }));

  expect(onCancel).toHaveBeenCalled();
  expect(onShare).not.toHaveBeenCalled();
});

test.each(['unavailable', 'incompatible'] as const)(
  'explains an %s backend and still allows sharing without audio',
  async (status) => {
    platform.status = status;
    platform.listScreenAudioApps.mockResolvedValue([]);
    const { onShare, user } = open();
    await user.click(await screen.findByRole('radio', { name: /Every app/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(
      status === 'incompatible' ? /C\+\+ runtime/ : /PipeWire/
    );
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /No audio/ }));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    expect(onShare).toHaveBeenCalledWith({ kind: 'none' });
  }
);

test('warns about missing pipewire-pulse without blocking native PipeWire audio', async () => {
  platform.status = 'pipewire-pulse-missing';
  platform.listScreenAudioApps.mockResolvedValue([]);
  const { user } = open();
  await user.click(await screen.findByRole('radio', { name: /Every app/ }));
  expect((await screen.findByRole('status')).textContent).toMatch(/pipewire-pulse/);
  expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
});

test('selects application audio by ID without the system-routing workaround', async () => {
  vi.stubGlobal('sableElectron', { platform: 'linux' });
  platform.listScreenAudioApps.mockResolvedValue(['stream-1', 'stream-2']);
  platform.labels = { 'stream-1': 'Firefox (Music)', 'stream-2': 'Firefox (Video)' };
  const { onShare, user } = open();
  await user.click(await screen.findByRole('radio', { name: /Chosen apps/ }));
  expect(
    screen.queryByRole('checkbox', { name: /Microphone routing workaround/ })
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole('checkbox', { name: 'Firefox (Video)' }));
  await user.click(screen.getByRole('button', { name: 'Share' }));
  expect(onShare).toHaveBeenCalledWith({ kind: 'apps', include: ['stream-2'] });
});

test('keeps the remembered apps on screen when the list cannot be read', async () => {
  platform.lastScreenAudioChoice.mockReturnValueOnce({ kind: 'apps', include: ['mpv'] } as never);
  platform.listScreenAudioApps.mockRejectedValue(new Error('no pipewire'));
  open();

  expect((await screen.findByRole('alert')).textContent).toMatch(/Refresh to try again/);
  expect(screen.getByRole('checkbox', { name: /mpv/ })).toBeChecked();
});

test('on a platform that shares one app, every app needs no list and a pick replaces the last', async () => {
  platform.screenAudioCanExclude.mockReturnValue(false);
  platform.screenAudioPicksMany.mockReturnValue(false);
  platform.listScreenAudioApps.mockResolvedValue(['chrome', 'Spotify']);
  const { onShare, user } = open();

  await user.click(await screen.findByRole('radio', { name: /Every app/ }));
  expect(platform.listScreenAudioApps).not.toHaveBeenCalled();
  await user.click(screen.getByRole('radio', { name: /One app/ }));
  await user.click(await screen.findByRole('radio', { name: 'chrome' }));
  await user.click(screen.getByRole('radio', { name: 'Spotify' }));
  await user.click(screen.getByRole('button', { name: 'Share' }));

  expect(onShare).toHaveBeenCalledWith({ kind: 'apps', include: ['Spotify'] });
});
