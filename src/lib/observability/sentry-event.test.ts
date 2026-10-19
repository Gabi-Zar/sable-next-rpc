import { expect, test } from 'vitest';

import { isLivekitMissingKey } from './sentry-event';

test('drops the console error livekit writes for a missing call key', () => {
  expect(
    isLivekitMissingKey({
      exception: {
        values: [
          { type: 'MissingKey', mechanism: { type: 'auto.core.capture_console', handled: true } },
        ],
      },
    })
  ).toBe(true);
});

test('keeps other console errors and other mechanisms', () => {
  expect(
    isLivekitMissingKey({
      exception: {
        values: [
          { type: 'Error', mechanism: { type: 'auto.core.capture_console', handled: true } },
        ],
      },
    })
  ).toBe(false);
  expect(isLivekitMissingKey({ exception: { values: [{ type: 'MissingKey' }] } })).toBe(false);
  expect(isLivekitMissingKey({})).toBe(false);
});
