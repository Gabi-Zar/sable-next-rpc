import { expect, test } from 'vitest';

import { parseMatrixLink } from './matrix-link';

test('the wasm binding round-trips a parsed link as JSON', () => {
  expect(parseMatrixLink('https://matrix.to/#/!room:example.org/$event')).toEqual({
    kind: 'event',
    room_id: '!room:example.org',
    event_id: '$event',
  });
  expect(parseMatrixLink('https://example.org/#/!room:example.org')).toBeNull();
});
