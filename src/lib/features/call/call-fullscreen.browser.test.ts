import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

vi.mock('./call-telemetry', () => ({ CallTelemetry: vi.fn() }));
vi.mock('#lib/platform/overlay-back.svelte.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/platform/overlay-back.svelte.js')>()),
  holdOverlayBack: () => {},
}));

import type { CallSession } from './call-session.svelte.js';
import { idleTransportState, type CallVideoRect } from './call-transport';
import CallViewHarness from './CallViewHarness.test.svelte';

afterEach(() => vi.restoreAllMocks());

test('both fullscreen controls resize native video', async () => {
  await page.viewport(390, 844);
  const request = vi.spyOn(HTMLElement.prototype, 'requestFullscreen');
  const place = vi.fn((_rect: CallVideoRect) => Promise.resolve());
  const session = {
    lifecycle: 'active',
    mediaReady: true,
    failure: null,
    deviceError: null,
    startedAt: null,
    layout: { pinned: null, gridForced: false },
    watchedScreenShareIds: ['screen'],
    views: 0,
    deafened: false,
    encryptsMedia: false,
    canScreenShare: false,
    canSwitchCamera: false,
    remoteVideo: { place, clear: vi.fn(() => Promise.resolve()) },
    rooms: [],
    members: [],
    transport: {
      ...idleTransportState(),
      connection: 'connected',
      self: { identity: 'me', local: true },
      participants: [
        { identity: 'bob', screenShare: { id: 'screen', muted: false, subscribed: true } },
      ],
    },
    roomFor: () => undefined,
    toggleWatchScreenShare: vi.fn(),
  } as unknown as CallSession;
  const { container, unmount } = await render(CallViewHarness, { session, members: [] });
  container.style.cssText = 'container-type:size;display:flex;width:280px;height:400px';
  const stage = container.querySelector<HTMLElement>('.stage');
  const tile = container.querySelector<HTMLElement>('.tile.screen');
  const slot = tile?.querySelector<HTMLElement>('.video');
  const top = stage?.querySelector<HTMLElement>('.top');
  if (!stage || !tile || !slot || !top) throw new Error('call not rendered');

  for (const [surface, controls] of [
    [stage, top],
    [tile, tile],
  ]) {
    await page.elementLocator(tile).hover();
    await page
      .elementLocator(controls)
      .getByRole('button', { name: 'Full screen', exact: true })
      .click();
    for (const [width, height] of [
      [390, 844],
      [844, 390],
    ]) {
      await page.viewport(width, height);
      await expect
        .poll(() => surface.getBoundingClientRect())
        .toMatchObject({
          x: 0,
          y: 0,
          width,
          height,
        });
      await expect
        .poll(() => {
          const rect = slot.getBoundingClientRect();
          const last = place.mock.calls.at(-1)?.[0];
          return (
            last && Math.abs(last.width - rect.width) < 1 && Math.abs(last.height - rect.height) < 1
          );
        })
        .toBe(true);
      expect(slot.clientWidth).toBeGreaterThan(0);
      expect(slot.clientHeight).toBeGreaterThan(0);
      expect(document.fullscreenElement).toBeNull();
      expect(tile.querySelector('.video')).toBe(slot);
    }
    await page.elementLocator(controls).getByRole('button', { name: 'Exit full screen' }).click();
    await expect.poll(() => container.contains(surface)).toBe(true);
  }
  expect(request).not.toHaveBeenCalled();

  await page.elementLocator(top).getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.elementLocator(tile).hover();
  await page.elementLocator(tile).getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.elementLocator(tile).getByRole('button', { name: 'Exit full screen' }).click();
  expect(stage.classList.contains('expanded')).toBe(true);
  expect(stage.contains(tile)).toBe(true);
  await page.elementLocator(tile).getByRole('button', { name: 'Full screen', exact: true }).click();
  await unmount();
  expect(document.querySelector('.expanded')).toBeNull();
});
