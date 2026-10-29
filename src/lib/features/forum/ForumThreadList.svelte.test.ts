// @vitest-environment happy-dom
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import ForumThreadList from './ForumThreadList.svelte';

test('a failed empty forum offers recovery', async () => {
  const retry = vi.fn();
  render(ForumThreadList, {
    threads: [],
    loading: false,
    failed: true,
    canLoadMore: false,
    onRetry: retry,
    onOpen: vi.fn(),
    canDelete: () => false,
    onDelete: vi.fn(),
    roomId: '!forum:example.org',
    onCopyLink: vi.fn(),
    onLoadMore: vi.fn(),
  });
  expect(screen.getByRole('alert')).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
});
