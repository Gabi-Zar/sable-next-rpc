// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import type {
  ImagePackView,
  RoomPermissionsView,
  RoomPowerLevelsView,
  RoomListItemView,
} from '#src/generated/protocol';

vi.mock('#lib/core/context.js');
vi.mock('#lib/i18n.js', () => import('#lib/test-support/i18n.js'));

import { core as baseCore } from '#lib/core/__mocks__/context.js';

import RoomEmojiSettings from './RoomEmojiSettings.svelte';

const core = Object.assign(baseCore, {
  imagePacks: vi.fn<() => Promise<{ packs: ImagePackView[]; complete: boolean }>>(() =>
    Promise.resolve({ packs: [], complete: true })
  ),
});

function pack(overrides: Partial<ImagePackView>): ImagePackView {
  return {
    id: 'stickers',
    origin: 'room',
    room_id: '!space:home.example',
    name: 'Stickers',
    avatar_url: null,
    declared_name: 'Stickers',
    declared_avatar_url: null,
    stable_event: true,
    legacy_event: false,
    attribution: null,
    usage: [],
    images: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

test('a pack enabled for every room is still listed in its own room', async () => {
  core.imagePacks.mockResolvedValue({
    packs: [
      pack({ origin: 'global' }),
      pack({ id: 'parent', name: 'Parent pack', origin: 'space', room_id: '!parent:home.example' }),
    ],
    complete: true,
  });
  const room = { room_id: '!space:home.example' } as RoomListItemView;
  render(RoomEmojiSettings, { room, permissions: null, levels: null });

  expect(await screen.findByText('Stickers')).toBeTruthy();
  expect(screen.queryByText('Parent pack')).toBeNull();
  expect(screen.queryByText('room.emojisEmpty')).toBeNull();
});

test('converting a legacy-only pack asks the core to copy it', async () => {
  core.imagePacks.mockResolvedValue({
    packs: [pack({ stable_event: false, legacy_event: true })],
    complete: true,
  });
  const convertLegacyImagePacks = vi.fn<() => Promise<null>>(() => Promise.resolve(null));
  Object.assign(core, { convertLegacyImagePacks });
  const room = { room_id: '!space:home.example' } as RoomListItemView;
  const levels: RoomPowerLevelsView = {
    ban: 50,
    kick: 50,
    redact: 50,
    invite: 0,
    events_default: 0,
    state_default: 50,
    users_default: 0,
    events: {},
    users: {},
    notifications_room: 50,
  };
  const permissions = { own_power_level: 100 } as RoomPermissionsView;
  render(RoomEmojiSettings, { room, permissions, levels });

  await userEvent.click(await screen.findByRole('button', { name: 'room.emojisLegacyConvert:1' }));

  await vi.waitFor(() => {
    expect(convertLegacyImagePacks).toHaveBeenCalledWith({
      room_id: '!space:home.example',
      state_keys: ['stickers'],
    });
  });
});
