// @vitest-environment happy-dom

import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { expect, test } from 'vitest';

import SettingsTitleHarness from './SettingsTitleHarness.test.svelte';

test.each([
  { from: 'Account', to: 'Media', expected: 'Media - Sable' },
  { from: 'Media', to: 'Appearance', expected: 'Appearance - Sable' },
  { from: 'Appearance', to: 'Account', expected: 'Account - Sable' },
])('updates the title from $from to $to', async ({ from, to, expected }) => {
  const view = render(SettingsTitleHarness, { title: from });
  await tick();

  await view.rerender({ title: to });
  await tick();

  expect(document.title).toBe(expected);
});

test('restores the room title after switching settings categories', async () => {
  document.title = 'General - Sable';
  const view = render(SettingsTitleHarness, { title: 'Account' });
  await tick();
  await view.rerender({ title: 'Media' });
  await tick();

  view.unmount();

  expect(document.title).toBe('General - Sable');
});
