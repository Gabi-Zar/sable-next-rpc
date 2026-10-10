import { expect, test, vi } from 'vitest';

import { CoreError } from '#src/transport';

import { pinsHash } from './pin-marker';
import { pinErrorMessage, PinnedEvents, type PinnedEventCommands } from './pinned-events.svelte.js';

function fakeCore(
  pinnedEvents = vi.fn(() => Promise.resolve<string[]>([])),
  setPinned = vi.fn(),
  roomAccountData = vi.fn(() => Promise.resolve<unknown>(null)),
  setRoomAccountData = vi.fn(() => Promise.resolve())
) {
  return {
    pinnedEvents,
    setPinned,
    roomAccountData,
    setRoomAccountData,
  } as unknown as PinnedEventCommands;
}

test('one load answers for every event in the room', async () => {
  const pinnedEvents = vi.fn(() => Promise.resolve(['$a', '$b']));
  const pins = new PinnedEvents(fakeCore(pinnedEvents));

  await pins.load('!room:example.org');

  expect(pinnedEvents).toHaveBeenCalledTimes(1);
  expect(pins.has('$a')).toBe(true);
  expect(pins.has('$b')).toBe(true);
  expect(pins.has('$c')).toBe(false);
  expect(pins.has(null)).toBe(false);
});

test('toggling updates the shared set without another fetch', async () => {
  const pinnedEvents = vi.fn(() => Promise.resolve(['$a']));
  const setPinned = vi.fn(() => Promise.resolve(['$a', '$b']));
  const pins = new PinnedEvents(fakeCore(pinnedEvents, setPinned));

  await pins.load('!room:example.org');
  await pins.toggle('!room:example.org', '$b');

  expect(setPinned).toHaveBeenCalledWith('!room:example.org', '$b', true);
  expect(pins.has('$b')).toBe(true);
  expect(pinnedEvents).toHaveBeenCalledTimes(1);
});

test('unpinning passes the current state through', async () => {
  const setPinned = vi.fn(() => Promise.resolve<string[]>([]));
  const pins = new PinnedEvents(
    fakeCore(
      vi.fn(() => Promise.resolve(['$a'])),
      setPinned
    )
  );

  await pins.load('!room:example.org');
  await pins.toggle('!room:example.org', '$a');

  expect(setPinned).toHaveBeenCalledWith('!room:example.org', '$a', false);
  expect(pins.has('$a')).toBe(false);
});

test('a slow load for the previous room cannot overwrite the current one', async () => {
  let release: (ids: string[]) => void = () => {};
  const pinnedEvents = vi
    .fn()
    .mockImplementationOnce(() => new Promise<string[]>((resolve) => (release = resolve)))
    .mockImplementationOnce(() => Promise.resolve(['$new']));
  const pins = new PinnedEvents(fakeCore(pinnedEvents));

  const stale = pins.load('!old:example.org');
  await pins.load('!new:example.org');
  release(['$old']);
  await stale;

  expect(pins.has('$new')).toBe(true);
  expect(pins.has('$old')).toBe(false);
});

test('a slow toggle for the previous room cannot overwrite the current one', async () => {
  let release: (ids: string[]) => void = () => {};
  const setPinned = vi.fn(() => new Promise<string[]>((resolve) => (release = resolve)));
  const pins = new PinnedEvents(
    fakeCore(
      vi.fn(() => Promise.resolve(['$new'])),
      setPinned
    )
  );

  const stale = pins.toggle('!old:example.org', '$old');
  await pins.load('!new:example.org');
  release(['$old']);
  await stale;

  expect(pins.has('$new')).toBe(true);
  expect(pins.has('$old')).toBe(false);
});

test('a failed load leaves the set intact rather than clearing it', async () => {
  const pinnedEvents = vi
    .fn()
    .mockImplementationOnce(() => Promise.resolve(['$a']))
    .mockImplementationOnce(() => Promise.reject(new Error('offline')));
  const pins = new PinnedEvents(fakeCore(pinnedEvents));

  await pins.load('!room:example.org');
  await pins.load('!room:example.org');

  expect(pins.has('$a')).toBe(true);
});

test('a refused pin says so instead of asking to retry', () => {
  expect(pinErrorMessage(new CoreError({ code: 'denied' }))).toBe(
    "You don't have permission to pin messages in this room."
  );
  expect(pinErrorMessage(new CoreError({ code: 'failed', log_id: 'e1' }))).toBe(
    'Could not complete that action. Try again.'
  );
});

test('pinning with the marker at the end moves it onto the new pin', async () => {
  const room = '!room:example.org';
  const marker = { hash: await pinsHash(['$a']), count: 1, last_seen_id: '$a' };
  const setRoomAccountData = vi.fn(() => Promise.resolve());
  const pins = new PinnedEvents(
    fakeCore(
      vi.fn(() => Promise.resolve(['$a'])),
      vi.fn(() => Promise.resolve(['$a', '$b'])),
      vi.fn(() => Promise.resolve<unknown>(marker)),
      setRoomAccountData
    )
  );

  await pins.load(room);
  await pins.toggle(room, '$b');

  expect(setRoomAccountData).toHaveBeenCalledWith(room, 'moe.sable.app.pins_read_marker', {
    hash: await pinsHash(['$a', '$b']),
    count: 2,
    last_seen_id: '$b',
  });
});

test('pinning leaves the marker alone while earlier pins are unread', async () => {
  const room = '!room:example.org';
  const setRoomAccountData = vi.fn(() => Promise.resolve());
  const pins = new PinnedEvents(
    fakeCore(
      vi.fn(() => Promise.resolve(['$a'])),
      vi.fn(() => Promise.resolve(['$a', '$b'])),
      vi.fn(() => Promise.resolve<unknown>(null)),
      setRoomAccountData
    )
  );

  await pins.load(room);
  await pins.toggle(room, '$b');

  expect(setRoomAccountData).not.toHaveBeenCalled();
});

test('a refused pin puts the previous marker back', async () => {
  const room = '!room:example.org';
  const marker = { hash: await pinsHash(['$a']), count: 1, last_seen_id: '$a' };
  const setRoomAccountData = vi.fn(() => Promise.resolve());
  const pins = new PinnedEvents(
    fakeCore(
      vi.fn(() => Promise.resolve(['$a'])),
      vi.fn(() => Promise.reject(new Error('denied'))),
      vi.fn(() => Promise.resolve<unknown>(marker)),
      setRoomAccountData
    )
  );

  await pins.load(room);
  await expect(pins.toggle(room, '$b')).rejects.toThrow('denied');

  expect(setRoomAccountData).toHaveBeenLastCalledWith(
    room,
    'moe.sable.app.pins_read_marker',
    marker
  );
});
