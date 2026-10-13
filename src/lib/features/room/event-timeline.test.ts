import { expect, test } from 'vitest';

import type { RoomListItemView } from '#src/generated/protocol';

import { spaceTimelinePath } from './event-timeline.js';

test.each([
  [null, '!space%3Aexample.org'],
  ['#space:example.org', '%23space%3Aexample.org'],
])('a space timeline keeps its space route with alias %s', (canonical_alias, pathId) => {
  const space = { room_id: '!space:example.org', canonical_alias } as RoomListItemView;

  expect(spaceTimelinePath(space, [space])).toBe(`/space/${pathId}/${pathId}?timeline=events`);
});
