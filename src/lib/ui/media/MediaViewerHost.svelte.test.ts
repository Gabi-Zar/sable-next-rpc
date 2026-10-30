// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('#lib/core/context.js');

import { core } from '#lib/core/__mocks__/context.js';
import { imageItem } from '#lib/features/room/timeline/timeline-item-fixtures.js';
import MediaViewerHost from './MediaViewerHost.svelte';
import { mediaViewerState as viewer } from './media-viewer-state.svelte.js';

afterEach(() => {
  viewer.close();
  core.fetchMedia.mockReset();
});

test('ending a signed-in view clears media before the next session mounts', async () => {
  core.fetchMedia.mockResolvedValue(new Uint8Array(new ArrayBuffer()));
  viewer.open('$item', () => [imageItem()], vi.fn());
  const host = render(MediaViewerHost);
  await screen.findByRole('dialog');

  host.unmount();

  expect(viewer.eventId).toBeNull();
  expect(viewer.items).toEqual([]);
  expect(viewer.onJump).toBeUndefined();
  render(MediaViewerHost);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
