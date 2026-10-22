import { expect, test } from 'vitest';

import { alertCooling, NOTIFY_ONCE_WINDOW_MS } from './alert-cooldown';

test('a room that alerted stays quiet only for the notify-once window', () => {
  expect(alertCooling(undefined, 1_000)).toBe(false);
  expect(alertCooling(1_000, 1_000)).toBe(true);
  expect(alertCooling(1_000, 1_000 + NOTIFY_ONCE_WINDOW_MS - 1)).toBe(true);
  expect(alertCooling(1_000, 1_000 + NOTIFY_ONCE_WINDOW_MS)).toBe(false);
  expect(alertCooling(5_000, 1_000)).toBe(false);
});
