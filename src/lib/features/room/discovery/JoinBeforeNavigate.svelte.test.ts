// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import type { RoomPreviewView } from '#src/generated/protocol';

vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));
vi.mock('#lib/core/context.js');
vi.mock('#lib/rooms/room-list.svelte.js', () => ({
  useRoomList: () => ({ rooms: [] }),
}));

import { core as baseCore } from '#lib/core/__mocks__/context.js';

const core = baseCore;
Object.assign(core.rpc.rooms, {
  preview: vi.fn<() => Promise<RoomPreviewView>>(),
  knock:
    vi.fn<(params: { address: string; via: string[]; reason: string | null }) => Promise<string>>(),
  leave: vi.fn<(params: { room_id: string }) => Promise<null>>(),
});

import JoinBeforeNavigate from './JoinBeforeNavigate.svelte';
import { t } from '#lib/i18n.js';

function preview(overrides: Partial<RoomPreviewView> = {}): RoomPreviewView {
  return {
    room_id: '!room:example.org',
    canonical_alias: null,
    name: 'Knock room',
    topic: null,
    avatar_url: null,
    room_kind: 'text',
    num_joined_members: 3,
    join_rule: 'knock',
    state: null,
    via: { type: 'unknown' },
    ...overrides,
  };
}

afterEach(() => {
  core.rpc.rooms.preview.mockReset();
  core.rpc.rooms.knock.mockReset();
  core.rpc.rooms.leave.mockReset();
});

test('sends the optional message with the request to join', async () => {
  const user = userEvent.setup();
  core.rpc.rooms.preview.mockResolvedValue(preview());
  core.rpc.rooms.knock.mockResolvedValue('!room:example.org');
  render(JoinBeforeNavigate, { roomId: '!room:example.org' });

  await user.type(await screen.findByLabelText(t('join.knockReason')), '  a friend of Ana  ');
  await user.click(screen.getByRole('button', { name: t('common.askToJoin') }));

  expect(core.rpc.rooms.knock).toHaveBeenCalledWith({
    address: '!room:example.org',
    via: [],
    reason: 'a friend of Ana',
  });
  expect(screen.getByRole('status')).toHaveTextContent(t('join.knockSent'));
});

test('a blank message sends no reason', async () => {
  const user = userEvent.setup();
  core.rpc.rooms.preview.mockResolvedValue(preview());
  core.rpc.rooms.knock.mockResolvedValue('!room:example.org');
  render(JoinBeforeNavigate, { roomId: '!room:example.org' });

  await user.click(await screen.findByRole('button', { name: t('common.askToJoin') }));

  expect(core.rpc.rooms.knock).toHaveBeenCalledWith({
    address: '!room:example.org',
    via: [],
    reason: null,
  });
});

test('a pending request can be withdrawn', async () => {
  const user = userEvent.setup();
  core.rpc.rooms.preview.mockResolvedValue(preview());
  core.rpc.rooms.leave.mockResolvedValue(null);
  render(JoinBeforeNavigate, { roomId: '!room:example.org', membership: "knocked" });

  await user.click(await screen.findByRole('button', { name: t('join.withdraw') }));

  expect(core.rpc.rooms.leave).toHaveBeenCalledWith({ room_id: '!room:example.org' });
  expect(screen.getByRole('button', { name: t('common.askToJoin') })).toBeInTheDocument();
});
