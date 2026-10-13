import { expect, test, vi } from 'vitest';
import type {
  RoomOpenView,
  RoomPowerLevelsView,
  RoomStateEventView,
} from '#src/generated/protocol';
import { RoomSession } from './room-session.svelte.js';
import { FOUNDER_POWER_LEVEL } from './settings/power-level-tags';

function deferred<T>() {
  return Promise.withResolvers<T>();
}

function opened(eventId: string): RoomOpenView {
  return {
    permissions: {
      own_power_level: 0,
      can_post: true,
      can_react: true,
      can_redact_own: true,
      can_redact_others: false,
      can_invite: true,
      can_kick: false,
      can_ban: false,
      can_change_settings: false,
      can_pin: false,
      can_change_join_rule: false,
      can_change_power_levels: false,
      can_manage_children: false,
    },
    power_level_tags: {},
    widgets: [],
    pinned_event_ids: [eventId],
    predecessor: null,
  };
}

function fixture() {
  const rooms = { roomOpen: vi.fn(() => Promise.resolve(opened('$new'))) };
  const members = {
    roomPowerLevels: vi.fn((): Promise<RoomPowerLevelsView> =>
      Promise.resolve({
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
      })
    ),
  };
  const roomState = {
    roomStateEvent: vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve(null)),
    memberListThreshold: vi.fn((..._args: unknown[]): Promise<number | null> =>
      Promise.resolve(null)
    ),
    roomStateEvents: vi.fn((..._args: unknown[]): Promise<RoomStateEventView[]> =>
      Promise.resolve([])
    ),
    addRoomWidget: vi.fn((..._args: unknown[]) => Promise.resolve('new')),
    removeRoomWidget: vi.fn((..._args: unknown[]) => Promise.resolve(null)),
  };
  const pins = { set: vi.fn() };
  return {
    roomState,
    rooms,
    pins,
    session: new RoomSession({ room_state: roomState, rooms, members }, pins),
  };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

test('opening a room loads the saved founder flair', async () => {
  const { rooms, session } = fixture();
  rooms.roomOpen.mockResolvedValueOnce({
    ...opened('$new'),
    power_level_tags: {
      [String(FOUNDER_POWER_LEVEL)]: { name: 'Founder', color: '#ff0000', icon: '👑' },
    },
  });

  session.sync('!room', false, 0);
  await settle();

  expect(session.powerTags?.[FOUNDER_POWER_LEVEL]).toEqual({
    name: 'Founder',
    color: '#ff0000',
    icon: '👑',
  });
});

test('room changes discard stale details and pin updates', async () => {
  const { rooms, pins, session } = fixture();
  const old = deferred<RoomOpenView>();
  rooms.roomOpen.mockReturnValueOnce(old.promise);
  session.sync('!old', false, 0);
  session.sync('!new', false, 0);
  await settle();
  old.resolve(opened('$old'));
  await settle();
  expect(pins.set).toHaveBeenCalledExactlyOnceWith('!new', ['$new']);
  expect(session.permissions).toEqual(opened('$new').permissions);
  expect(session.powerLevels?.invite).toBe(0);
});

test('disposing a room discards its pending requests', async () => {
  const { rooms, pins, session } = fixture();
  const request = deferred<RoomOpenView>();
  rooms.roomOpen.mockReturnValueOnce(request.promise);
  session.sync('!room', false, 0);
  session.dispose();
  request.resolve(opened('$late'));
  await settle();
  expect(session.permissions).toBeNull();
  expect(session.powerLevels).toBeNull();
  expect(pins.set).not.toHaveBeenCalled();
});

test('widget removal cannot populate the next room with the previous room widgets', async () => {
  const { roomState, session } = fixture();
  const widgets = deferred<RoomStateEventView[]>();
  roomState.roomStateEvents.mockReturnValueOnce(widgets.promise);
  session.sync('!old', false, 0);
  await settle();
  const removal = session.details.removeWidget('widget');
  await settle();
  session.sync('!new', false, 0);
  await settle();
  widgets.resolve([
    {
      state_key: 'old',
      content: { type: 'm.custom', url: 'https://example.org/widget' },
    },
  ]);
  await removal;
  expect(roomState.removeRoomWidget).toHaveBeenCalledWith({
    room_id: '!old',
    widget_id: 'widget',
  });
  expect(session.widgets).toEqual([]);
});

test('tombstone completion and member settings are cancelled on room change', async () => {
  const { roomState, session } = fixture();
  const tombstone = deferred<unknown>();
  const listing = deferred<number | null>();
  roomState.memberListThreshold.mockReturnValueOnce(listing.promise);
  roomState.roomStateEvent.mockReturnValueOnce(tombstone.promise);
  session.sync('!old', true, 0);
  session.sync('!new', false, 1);
  tombstone.resolve({ replacement_room: '!replacement', body: 'old' });
  listing.resolve(50);
  await settle();
  expect(session.tombstoneReplacementId).toBeNull();
  expect(session.tombstoneChecked).toBe(false);
  expect(session.alwaysListedFrom).toBeNull();
});

test('a member list revision keeps the current setting until the new one lands', async () => {
  const { roomState, session } = fixture();
  roomState.memberListThreshold.mockResolvedValueOnce(50);
  session.sync('!room', false, 0);
  await settle();
  expect(session.alwaysListedFrom).toBe(50);

  const next = deferred<number | null>();
  roomState.memberListThreshold.mockReturnValueOnce(next.promise);
  session.sync('!room', false, 1);
  expect(session.alwaysListedFrom).toBe(50);

  next.resolve(100);
  await settle();
  expect(session.alwaysListedFrom).toBe(100);
});

test('adding a widget goes through the core and reloads the list', async () => {
  const { roomState, session } = fixture();
  roomState.roomStateEvents.mockResolvedValueOnce([
    {
      state_key: 'new',
      content: { type: 'm.custom', url: 'https://example.org/widget' },
    },
  ]);
  session.sync('!room', false, 0);
  await settle();

  await session.details.addWidget('Doom', 'https://example.org/widget');

  expect(roomState.addRoomWidget).toHaveBeenCalledWith({
    room_id: '!room',
    name: 'Doom',
    url: 'https://example.org/widget',
  });
  expect(session.widgets).toHaveLength(1);
});
