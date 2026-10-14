import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { TypingNotifier } from './typing-notifier';

let roomId = '!a:example.org';
let calls: Array<[string, boolean]> = [];

function notifier(): TypingNotifier {
  return new TypingNotifier(
    () => roomId,
    (room, typing) => {
      calls.push([room, typing]);
      return Promise.resolve();
    }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  roomId = '!a:example.org';
  calls = [];
});

afterEach(() => {
  vi.useRealTimers();
});

test('announces typing and stops after the timeout', () => {
  const typing = notifier();

  typing.update(false);
  expect(calls).toEqual([['!a:example.org', true]]);

  vi.advanceTimersByTime(4000);
  expect(calls).toEqual([
    ['!a:example.org', true],
    ['!a:example.org', false],
  ]);
});

test('stops typing when the draft becomes empty', () => {
  const typing = notifier();

  typing.update(false);
  typing.update(true);
  vi.advanceTimersByTime(4000);

  expect(calls).toEqual([
    ['!a:example.org', true],
    ['!a:example.org', false],
  ]);
});

test('stop cancels the pending timeout', () => {
  const typing = notifier();

  typing.update(false);
  typing.stop();
  vi.advanceTimersByTime(4000);

  expect(calls).toEqual([
    ['!a:example.org', true],
    ['!a:example.org', false],
  ]);
});

test('leave notifies the room being left only while typing is pending', () => {
  const typing = notifier();

  typing.leave('!old:example.org');
  expect(calls).toEqual([]);

  typing.update(false);
  roomId = '!b:example.org';
  typing.leave('!a:example.org');
  vi.advanceTimersByTime(4000);

  expect(calls).toEqual([
    ['!a:example.org', true],
    ['!a:example.org', false],
  ]);
});

test('swallows notification failures', async () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  const typing = new TypingNotifier(
    () => roomId,
    () => Promise.reject(new Error('offline'))
  );

  typing.stop();
  await vi.runAllTimersAsync();

  expect(debug).toHaveBeenCalledWith(
    '[sable composer] typing notification failed',
    expect.any(Error)
  );
  debug.mockRestore();
});
