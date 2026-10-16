// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';

vi.mock('#lib/i18n.js', () => import('#lib/test-support/i18n.js'));
vi.mock('../search/SearchView.svelte', () => import('./RoomSearchPanelSearchViewStub.test.svelte'));

import RoomSearchPanel from './RoomSearchPanel.svelte';

test('the inline panel keeps its resize handle', () => {
  render(RoomSearchPanel, { query: '', onClose: () => {} });
  expect(screen.getByRole('complementary')).not.toHaveClass('modal');
  expect(screen.getByRole('slider')).toBeInTheDocument();
});

test('the modal panel opens in a dialog without a resize handle', async () => {
  render(RoomSearchPanel, { query: '', modal: true, onClose: () => {} });
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toContainElement(screen.getByRole('complementary'));
  expect(screen.getByRole('complementary')).toHaveClass('modal');
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
});
