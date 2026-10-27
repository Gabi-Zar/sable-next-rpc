// @vitest-environment happy-dom

import { screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { renderWithTooltips } from '#lib/test-support/render-with-tooltips.js';

vi.mock('#lib/core/context.js');
vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));
vi.mock('$app/state', () => import('#lib/test-support/app-state.js'));
vi.mock('#lib/rooms/room-list.svelte.js', () => ({
  useRoomList: () => ({ labelFor: () => 'Emoji room' }),
}));
vi.mock('#lib/emoji/load-packs.js', () => ({ invalidatePacks: vi.fn() }));
vi.mock('./pack-transfer.js', () => ({ exportPacks: vi.fn().mockResolvedValue('saved') }));

import { core } from '#lib/core/__mocks__/context.js';
import { exportPacks } from './pack-transfer.js';
import EmoteSettings from './EmoteSettings.svelte';

const address = { room_id: '!emoji:example.org', state_key: 'animals' };
const setSubscriptions = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  const pack = {
    id: 'animals',
    origin: 'room',
    room_id: '!emoji:example.org',
    name: 'Animals',
    declared_name: 'Animals',
    declared_avatar_url: null,
    usage: ['emoticon'],
    images: [],
  };
  Object.assign(core.rpc.packs, {
    listAll: vi.fn().mockResolvedValue([pack]),
    subscriptions: vi.fn().mockResolvedValue([]),
    setSubscriptions: setSubscriptions.mockReset(),
  });
});

test('exporting all packs leaves global subscriptions unchanged', async () => {
  renderWithTooltips(EmoteSettings, {});
  const user = userEvent.setup();
  const exportAll = await screen.findByRole('button', { name: 'Export all' });

  await user.click(exportAll);

  await vi.waitFor(() => {
    expect(exportPacks).toHaveBeenCalledOnce();
  });
  expect(setSubscriptions).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: 'Use Animals everywhere' })).not.toBeChecked();
});

test('bulk controls enable and disable global pack subscriptions', async () => {
  setSubscriptions.mockResolvedValueOnce([address]).mockResolvedValueOnce([]);
  renderWithTooltips(EmoteSettings, {});
  const user = userEvent.setup();
  const useAll = await screen.findByRole('button', { name: 'Use all everywhere' });
  const toggle = screen.getByRole('switch', { name: 'Use Animals everywhere' });

  await user.click(useAll);

  const stopAll = await screen.findByRole('button', { name: 'Stop using all everywhere' });
  expect(setSubscriptions).toHaveBeenLastCalledWith({ added: [address], removed: [] });
  expect(toggle).toBeChecked();

  await user.click(stopAll);

  await screen.findByRole('button', { name: 'Use all everywhere' });
  expect(setSubscriptions).toHaveBeenLastCalledWith({ added: [], removed: [address] });
  expect(toggle).not.toBeChecked();
});
