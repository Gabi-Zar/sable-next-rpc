// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import ScreenSharePickerDialog from './ScreenSharePickerDialog.svelte';

const sources = [
  { id: 'screen:0:0', name: 'Entire screen', thumbnail: 'data:image/png;base64,' },
  { id: 'window:42:0', name: 'Firefox', thumbnail: 'data:image/png;base64,' },
];

function open() {
  const onShare = vi.fn();
  const onCancel = vi.fn();
  render(ScreenSharePickerDialog, { sources, onShare, onCancel });
  return { onShare, onCancel, user: userEvent.setup() };
}

test('groups screens apart from windows', async () => {
  open();

  expect(await screen.findByRole('heading', { name: 'Screens' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Windows' })).toBeTruthy();
});

test('shares the first screen unless another source is picked', async () => {
  const { onShare, user } = open();

  await user.click(await screen.findByRole('button', { name: 'Share' }));

  expect(onShare).toHaveBeenCalledWith('screen:0:0');
});

test('shares the window that was picked', async () => {
  const { onShare, user } = open();

  await user.click(await screen.findByRole('radio', { name: 'Firefox' }));
  await user.click(screen.getByRole('button', { name: 'Share' }));

  expect(onShare).toHaveBeenCalledWith('window:42:0');
});

test('cancelling shares nothing', async () => {
  const { onShare, onCancel, user } = open();

  await user.click(await screen.findByRole('button', { name: 'Cancel' }));

  expect(onCancel).toHaveBeenCalled();
  expect(onShare).not.toHaveBeenCalled();
});
