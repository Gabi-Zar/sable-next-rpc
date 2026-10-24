import { expect, test, vi } from 'vitest';

import type { PushFetchView } from '#src/generated/protocol';

import {
  acknowledgeWebPusher,
  completePushPayload,
  namesOnlyItsEvent,
  type PushFetcher,
  readPushFetch,
} from './push-fetch';
import { pushNotification } from '#lib/notifications/push-fixtures.js';

const ROOM = '!room:example.org';
const bare = pushNotification({ room_id: ROOM, event_id: '$event', user_id: '@me:example.org' });

function fetcher(
  responses: Record<string, unknown>,
  decrypt: PushFetchView | null = null,
  roomName: string | null = null
): PushFetcher & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn((url: string) => {
    const path = decodeURIComponent(new URL(url).pathname);
    const body = responses[path];
    return Promise.resolve(
      body === undefined ? new Response(null, { status: 404 }) : Response.json(body)
    );
  });
  return {
    session: {
      userId: '@me:example.org',
      homeserver: 'https://hs.example/',
      accessToken: 'token',
    },
    fetch,
    roomName: () => Promise.resolve(roomName),
    decrypt: () => Promise.resolve(decrypt),
  } as PushFetcher & { fetch: ReturnType<typeof vi.fn> };
}

const base = `/_matrix/client/v3/rooms/${ROOM}`;

test('only a push that names nothing but its event is fetched', () => {
  expect(namesOnlyItsEvent(bare)).toBe(true);
  expect(namesOnlyItsEvent({ ...bare, type: 'm.room.message' })).toBe(false);
  expect(namesOnlyItsEvent(pushNotification({ room_id: ROOM }))).toBe(false);
});

test('a plaintext event is completed with its sender and room, with the token', async () => {
  const source = fetcher({
    [`${base}/event/$event`]: {
      type: 'm.room.message',
      sender: '@alice:example.org',
      content: { msgtype: 'm.text', body: 'hello' },
    },
    [`${base}/state/m.room.member/@alice:example.org`]: { displayname: 'Alice' },
    [`${base}/state/m.room.name/`]: { name: 'Garden' },
  });

  const completed = await completePushPayload(bare, source);

  expect(completed).toMatchObject({
    type: 'm.room.message',
    content: { body: 'hello' },
    sender_display_name: 'Alice',
    room_name: 'Garden',
  });
  expect(source.fetch.mock.calls[0]?.[1]).toMatchObject({
    headers: { Authorization: 'Bearer token' },
  });
});

test.each([false, true])('fetches rich text as plain text (encrypted: %s)', async (encrypted) => {
  const content = {
    msgtype: 'm.text',
    body: '<a data-mention-type="user" href="https://matrix.to/#/@alice:example.org" contenteditable="false">Alice</a> hi &amp; welcome',
    format: 'org.matrix.custom.html',
    formatted_body: '<a href="https://matrix.to/#/@alice:example.org">Alice</a> hi &amp; welcome',
  };
  const completed = await completePushPayload(
    bare,
    fetcher(
      {
        [`${base}/event/$event`]: {
          type: encrypted ? 'm.room.encrypted' : 'm.room.message',
          sender: '@alice:example.org',
          content: encrypted ? { ciphertext: 'x' } : content,
        },
      },
      {
        kind: 'event',
        event: {
          type: 'm.room.message',
          content,
          sender: '@alice:example.org',
          sender_display_name: 'Alice',
          room_name: 'Garden',
          room_avatar_url: null,
          encrypted: true,
          noisy: false,
        },
      }
    )
  );
  expect(completed?.content.body).toBe('Alice hi & welcome');
});

test('a room with no name is titled after its sender, unless the app stored one', async () => {
  const responses = {
    [`${base}/event/$event`]: { type: 'm.room.message', sender: '@alice:example.org', content: {} },
  };

  expect((await completePushPayload(bare, fetcher(responses)))?.room_name).toBe(
    '@alice:example.org'
  );
  expect((await completePushPayload(bare, fetcher(responses, null, 'Stored')))?.room_name).toBe(
    'Stored'
  );
});

test('an encrypted event takes what the open tab decrypted, and remembers it was encrypted', async () => {
  const completed = await completePushPayload(
    bare,
    fetcher(
      {
        [`${base}/event/$event`]: {
          type: 'm.room.encrypted',
          sender: '@alice:example.org',
          content: { ciphertext: 'x' },
        },
      },
      {
        kind: 'event',
        event: {
          type: 'm.room.message',
          content: { body: 'secret' },
          sender: '@alice:example.org',
          sender_display_name: 'Alice',
          room_name: 'Alice',
          room_avatar_url: null,
          encrypted: true,
          noisy: false,
        },
      }
    )
  );

  expect(completed).toMatchObject({
    type: 'm.room.message',
    content: { body: 'secret' },
    decrypted: true,
  });
});

test('an encrypted event no tab could read stays encrypted, and a silenced one is dropped', async () => {
  const responses = {
    [`${base}/event/$event`]: {
      type: 'm.room.encrypted',
      sender: '@alice:example.org',
      content: { ciphertext: 'x' },
    },
  };

  expect((await completePushPayload(bare, fetcher(responses)))?.type).toBe('m.room.encrypted');
  expect(await completePushPayload(bare, fetcher(responses, { kind: 'discard' }))).toBeNull();
});

test.each([403, 404])(
  'an event the server answers %i for is an invitation to a room not yet joined',
  async (status) => {
    const forbidden = fetcher({}, null, 'Design crew');
    forbidden.fetch.mockResolvedValue(new Response(null, { status }));

    const completed = await completePushPayload(bare, forbidden);

    expect(completed).toMatchObject({
      type: 'm.room.member',
      content: { membership: 'invite' },
      room_name: 'Design crew',
    });
  }
);

test.each([500, 'offline'])(
  'a fetch that fails with %s leaves the payload as it arrived',
  async (failure) => {
    const failing = fetcher({});
    if (typeof failure === 'number') {
      failing.fetch.mockResolvedValue(new Response(null, { status: failure }));
    } else {
      failing.fetch.mockRejectedValue(new Error(failure));
    }
    expect(await completePushPayload(bare, failing)).toBe(bare);
  }
);

test('a tab answer is only trusted in the shape the core sends', () => {
  expect(readPushFetch({ kind: 'discard' })).toEqual({ kind: 'discard' });
  expect(readPushFetch({ kind: 'unavailable' })).toBeNull();
  expect(readPushFetch({ kind: 'event', event: { type: 'm.room.message' } })).toBeNull();
  expect(readPushFetch(null)).toBeNull();
});

const session = { userId: '@me:example.org', homeserver: 'https://hs.example/', accessToken: 't' };
const validation = { app_id: 'moe.sable.webpush', ack_token: 'tok' };

test('the worker acknowledges a web push validation with the stored session', async () => {
  const send = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));

  await expect(acknowledgeWebPusher(session, validation, send)).resolves.toBe(true);

  const [url, init] = send.mock.calls[0] ?? [];
  expect(url).toBe('https://hs.example/_matrix/client/unstable/org.matrix.msc4174/pushers/ack');
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer t');
  expect(JSON.parse(init?.body as string)).toEqual(validation);
});

test('a rejected acknowledgement is final and left for an open tab', async () => {
  const send = vi.fn(() => Promise.resolve(Response.json({}, { status: 400 })));

  await expect(acknowledgeWebPusher(session, validation, send)).resolves.toBe(false);
  expect(send).toHaveBeenCalledOnce();
});

test('an unreachable homeserver is asked again before giving up', async () => {
  const send = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(Response.json({}, { status: 502 }))
    .mockResolvedValueOnce(Response.json({}));
  const pause = vi.fn(() => Promise.resolve());

  await expect(acknowledgeWebPusher(session, validation, send, pause)).resolves.toBe(true);
  expect(send).toHaveBeenCalledTimes(3);
  expect(pause).toHaveBeenCalledTimes(2);
});
