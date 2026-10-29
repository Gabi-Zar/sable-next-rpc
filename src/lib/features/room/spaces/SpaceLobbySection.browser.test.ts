import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import { buildHierarchySections } from './space-hierarchy';
import { sectionProps, space } from './lobby-section-fixtures';
import SpaceLobbySection from './SpaceLobbySection.svelte';

test('a long subspace name truncates instead of widening the lobby', async () => {
  await page.viewport(390, 800);
  const name = 'some subspace with a really long name that does not fit on a phone';
  const [section] = buildHierarchySections(
    [
      space('!root:example.org', 'public', ['!sub:example.org']),
      space('!sub:example.org', 'public', [], name),
    ],
    '!root:example.org',
    { joined: [], keepEmpty: ['!sub:example.org'] }
  );

  await render(SpaceLobbySection, sectionProps(section, []));

  expect(document.documentElement.scrollWidth).toBe(390);
});

test('a long room name and topic stay within a narrow lobby', async () => {
  await page.viewport(320, 800);
  const child = {
    ...space('!room:example.org', 'public', [], 'A very long room name '.repeat(8)),
    is_space: false,
    topic: 'A very long room topic '.repeat(8),
  };
  const [section] = buildHierarchySections(
    [space('!root:example.org', 'public', [child.room_id]), child],
    '!root:example.org',
    { joined: [] }
  );

  await render(SpaceLobbySection, sectionProps(section, []));

  const room = document.querySelector('.room');
  const text = room?.querySelector('.room-text');
  if (!room || !text) throw new Error('Expected a room row');
  expect(room.scrollWidth).toBeLessThanOrEqual(room.clientWidth);
  expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
});
