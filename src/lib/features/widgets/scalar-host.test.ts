import { expect, test, vi } from 'vitest';

import { answerScalarRequest, ScalarError } from './scalar-host.js';

const ROOM = '!room:example.org';
const ME = '@me:example.org';

function rpcWith(state: Record<string, Record<string, unknown>[]>) {
  const eventsRaw = vi.fn(
    ({ event_type, state_key }: { event_type: string; state_key: string | null }) =>
      Promise.resolve(
        (state[event_type] ?? []).filter(
          (event) => state_key === null || event.state_key === state_key
        )
      )
  );
  const sendEvent = vi.fn(() => Promise.resolve('$sent'));
  return { rpc: { room_state: { eventsRaw, sendEvent } } as never, sendEvent };
}

const ask = (rpc: never, request: Record<string, unknown>) =>
  answerScalarRequest(rpc, ROOM, ME, { room_id: ROOM, ...request });

test('answers the room data a manager loads with', async () => {
  const { rpc } = rpcWith({
    'm.room.power_levels': [{ state_key: '', content: { users: { [ME]: 100 } } }],
    'm.room.encryption': [{ state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } }],
  });

  expect(await ask(rpc, { action: 'get_room_enc_state' })).toBe(true);
  expect(
    await ask(rpc, { action: 'read_events', type: 'm.room.power_levels', state_key: '' })
  ).toEqual({ events: [{ state_key: '', content: { users: { [ME]: 100 } } }] });
});

test('refuses to read state types the manager has no business with', async () => {
  const { rpc } = rpcWith({});

  await expect(
    ask(rpc, { action: 'read_events', type: 'm.room.topic', state_key: '' })
  ).rejects.toThrow(ScalarError);
});

test('counts joined members only', async () => {
  const { rpc } = rpcWith({
    'm.room.member': [
      { state_key: ME, content: { membership: 'join' } },
      { state_key: '@b:example.org', content: { membership: 'leave' } },
    ],
  });

  expect(await ask(rpc, { action: 'get_membership_count' })).toBe(1);
});

test('permits an event only at the sender power level', async () => {
  const { rpc } = rpcWith({
    'm.room.member': [{ state_key: ME, content: { membership: 'join' } }],
    'm.room.power_levels': [
      { state_key: '', content: { users: { [ME]: 50 }, state_default: 100 } },
    ],
  });

  expect(await ask(rpc, { action: 'can_send_event', event_type: 'm.room.message' })).toBe(true);
  await expect(
    ask(rpc, { action: 'can_send_event', event_type: 'im.vector.modular.widgets', is_state: true })
  ).rejects.toThrow(ScalarError);
});

test('writes and removes a room widget as a state event', async () => {
  const { rpc, sendEvent } = rpcWith({});

  await ask(rpc, {
    action: 'set_widget',
    widget_id: 'w1',
    type: 'm.custom',
    url: 'https://w',
    name: 'W',
  });
  await ask(rpc, { action: 'set_widget', widget_id: 'w1', url: null });

  expect(sendEvent).toHaveBeenNthCalledWith(1, {
    room_id: ROOM,
    event_type: 'im.vector.modular.widgets',
    state_key: 'w1',
    content: { type: 'm.custom', url: 'https://w', name: 'W', creatorUserId: ME },
  });
  expect(sendEvent).toHaveBeenNthCalledWith(2, {
    room_id: ROOM,
    event_type: 'im.vector.modular.widgets',
    state_key: 'w1',
    content: {},
  });
});

test('rejects another room and unknown actions instead of staying silent', async () => {
  const { rpc } = rpcWith({});

  await expect(
    answerScalarRequest(rpc, ROOM, ME, { room_id: '!other:example.org', action: 'get_widgets' })
  ).rejects.toThrow(ScalarError);
  await expect(ask(rpc, { action: 'send_event' })).rejects.toThrow(ScalarError);
});
