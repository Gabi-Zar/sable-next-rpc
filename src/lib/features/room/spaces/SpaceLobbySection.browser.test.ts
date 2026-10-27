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
