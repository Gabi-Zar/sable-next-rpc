// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

const files = vi.hoisted(() => ({
  saveBytes:
    vi.fn<
      (
        bytes: Uint8Array,
        filename: string,
        mime: string
      ) => Promise<'saved' | 'cancelled' | 'failed'>
    >(),
}));

vi.mock('$app/state', () => import('#lib/test-support/app-state.js'));
vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));
vi.mock('#lib/core/context.js');
vi.mock('#lib/platform/files.js', () => files);

import { core as baseCore } from '#lib/core/__mocks__/context.js';

const exportRoomKeys =
  vi.fn<(params: { passphrase: string; room_id?: string }) => Promise<string>>();
Object.assign(baseCore, { rpc: { encryption: { exportRoomKeys } } });

import RoomKeyExportDialog from './RoomKeyExportDialog.svelte';

beforeEach(() => {
  exportRoomKeys.mockReset().mockResolvedValue('armored');
  files.saveBytes.mockReset().mockResolvedValue('saved');
});

test('exports only this room once the passphrase is confirmed', async () => {
  const user = userEvent.setup();
  render(RoomKeyExportDialog, { open: true, roomId: '!room:example.org' });
  const dialog = await screen.findByRole('dialog');
  const submit = within(dialog).getByRole('button', { name: 'Export' });

  await user.type(within(dialog).getByLabelText('Passphrase'), 'secret');
  expect(submit).toBeDisabled();
  await user.type(within(dialog).getByLabelText('Confirm passphrase'), 'secret');
  await user.click(submit);

  await vi.waitFor(() => {
    expect(exportRoomKeys).toHaveBeenCalledWith({
      passphrase: 'secret',
      room_id: '!room:example.org',
    });
    expect(files.saveBytes).toHaveBeenCalledOnce();
  });
});

test('says so when the keys cannot be saved', async () => {
  const user = userEvent.setup();
  files.saveBytes.mockResolvedValue('failed');
  render(RoomKeyExportDialog, { open: true, roomId: '!room:example.org' });
  const dialog = await screen.findByRole('dialog');

  await user.type(within(dialog).getByLabelText('Passphrase'), 'secret');
  await user.type(within(dialog).getByLabelText('Confirm passphrase'), 'secret');
  await user.click(within(dialog).getByRole('button', { name: 'Export' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be exported');
});
