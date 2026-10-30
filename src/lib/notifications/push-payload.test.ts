import { expect, test } from 'vitest';

import { pushNotification } from './push-fixtures';
import { parsePushPayload, pushAlert, silencedByRoomMode, webPushValidation } from './push-payload';

test('the wasm binding parses a payload and renders its alert across JSON', () => {
  const parsed = parsePushPayload(
    JSON.stringify({
      user_id: '@me:example.org',
      notification: {
        room_id: '!room:example.org',
        event_id: '$event',
        sender_display_name: 'Ada',
        content: { body: 'hello' },
      },
    })
  );

  if (parsed === null) throw new Error('invalid push payload');
  expect(parsePushPayload('invalid')).toBeNull();
  expect(pushAlert(parsed, 'Design crew', true)).toEqual({
    title: 'Design crew',
    body: 'Ada: hello',
    line: { sender: 'Ada', body: 'hello', eventId: '$event' },
    tag: '@me:example.org !room:example.org',
    room_id: '!room:example.org',
    event_id: '$event',
    ring: false,
    invite: false,
  });
  expect(pushAlert(parsed, 'Design crew', false)?.body).toBe('New message from Ada');
});

test('the wasm binding reports the room mode that silences a push', () => {
  const encrypted = pushNotification({ room_id: '!room:example.org', type: 'm.room.encrypted' });

  expect(silencedByRoomMode(encrypted, 'mentions')).toBe(true);
  expect(silencedByRoomMode(encrypted, null)).toBe(false);
});

test('the wasm binding reads the validation handshake and tolerates a missing body', () => {
  expect(
    webPushValidation(JSON.stringify({ app_id: 'moe.sable.webpush', ack_token: 'tok' }))
  ).toEqual({ app_id: 'moe.sable.webpush', ack_token: 'tok' });
  expect(webPushValidation(undefined)).toBeNull();
  expect(webPushValidation('not json')).toBeNull();
});
