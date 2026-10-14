import { expect, test } from 'vitest';
import type { TimelineItemView } from '#src/generated/protocol';
import { latestMemberChangeId } from './room-member-refresh.svelte.js';

function item(eventId: string | null, kind: string): TimelineItemView {
  return { event_id: eventId, content: { kind } } as unknown as TimelineItemView;
}

test('picks the newest membership or profile change with an event id', () => {
  expect(
    latestMemberChangeId([
      item('$join', 'membership'),
      item('$profile', 'profile_change'),
      item(null, 'membership'),
      item('$text', 'text'),
    ])
  ).toBe('$profile');
});

test('is null without member changes', () => {
  expect(latestMemberChangeId([item('$text', 'text')])).toBeNull();
  expect(latestMemberChangeId([])).toBeNull();
});
