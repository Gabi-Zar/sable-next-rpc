import { expect, test } from 'vitest';

import { parseJoinAddress } from './join-address';

test('the wasm binding round-trips a join address as JSON', () => {
  expect(parseJoinAddress('https://matrix.to/#/!abc:example.org?via=one.org')).toEqual({
    address: '!abc:example.org',
    via: ['one.org'],
  });
  expect(parseJoinAddress('')).toBeNull();
});
