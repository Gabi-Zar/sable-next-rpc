// @vitest-environment happy-dom

import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));
vi.mock('$app/state', () => import('#lib/test-support/app-state.js'));
vi.mock('$app/paths', () => ({
  resolve: (path: string, params: Record<string, string>) =>
    path.replace('/(app)', '').replace('[spaceId]', params.spaceId),
}));
vi.mock('#lib/i18n.js', () => import('#lib/test-support/i18n.js'));
vi.mock('#lib/rooms/room-list.svelte.js', () => ({
  useRoomList: () => ({
    rooms: [
      { room_id: '!space:example.org', name: 'Space', state: 'joined' },
      { room_id: '!room:example.org', state: 'joined' },
    ],
  }),
  roomPathParam: (room: { room_id: string }) => encodeURIComponent(room.room_id),
  findRoomByPathId: (rooms: { room_id: string }[], pathId: string) =>
    rooms.find((room) => room.room_id === pathId),
}));

import { goto } from '$app/navigation';
import { visit } from '#lib/test-support/app-state.js';
import { BREAKPOINTS } from '#lib/ui/breakpoints.js';
import Page from './+page.svelte';

const root = '/space/!space%3Aexample.org';
const matchMedia = window.matchMedia.bind(window);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test.each([false, true])('restores the saved space room (desktop=%s)', async (desktop) => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const media = matchMedia(query);
    if (query === BREAKPOINTS.wide) Object.defineProperty(media, 'matches', { value: desktop });
    return media;
  });
  localStorage.setItem(
    'sable-space-paths',
    JSON.stringify({ '!space:example.org': `${root}/!room%3Aexample.org` })
  );
  visit(root, { spaceId: '!space:example.org' });

  render(Page);
  await tick();

  expect(goto).toHaveBeenCalledWith(`${root}/!room%3Aexample.org`, { replace: true });
});
