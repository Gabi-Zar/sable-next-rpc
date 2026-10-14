import { expect, test } from 'vitest';
import type { MediaItem } from './media/media-viewer-types.js';
import type { StandaloneMedia } from './media/media-viewer-opener.svelte.js';
import { RoomMediaViewer } from './room-media-viewer.svelte.js';

const avatar: StandaloneMedia = {
  kind: 'image',
  filename: 'Alice',
  caption: null,
  html: null,
  source: 'mxc://example.org/alice',
  mime: null,
  width: null,
  height: null,
  size: null,
  blurhash: null,
  thumbnail: null,
  spoiler: null,
  animated: null,
  sender: 'Alice',
};

test('a standalone item replaces the timeline items with a fresh id each time', () => {
  const viewer = new RoomMediaViewer(() => []);
  viewer.openStandalone(avatar);
  expect(viewer.eventId).toBe('standalone-1');
  expect(viewer.items.map((item) => item.eventId)).toEqual(['standalone-1']);
  viewer.openStandalone(avatar);
  expect(viewer.eventId).toBe('standalone-2');
});

test('panel items win over the timeline until the viewer closes', () => {
  const viewer = new RoomMediaViewer(() => []);
  const panel = [{ ...avatar, eventId: '$panel' }] as MediaItem[];
  viewer.openPanel(panel, '$panel');
  expect(viewer.items).toEqual(panel);
  expect(viewer.eventId).toBe('$panel');
  viewer.close();
  expect(viewer.eventId).toBeNull();
  expect(viewer.panelItems).toBeNull();
  expect(viewer.items).toEqual([]);
});

test('opening timeline media drops panel and standalone items', () => {
  const viewer = new RoomMediaViewer(() => []);
  viewer.openStandalone(avatar);
  viewer.open('$event');
  expect(viewer.eventId).toBe('$event');
  expect(viewer.standaloneItem).toBeNull();
  expect(viewer.items).toEqual([]);
});
