import { expect, test } from 'vitest';

import { isUserId } from './guards.js';

test.each(['@alice:example.org', '@alice:localhost:8008', '@name:[::1]:8448', '@旧名:server'])(
  'accepts the existing form grammar for %s',
  (value) => {
    expect(isUserId(value)).toBe(true);
  }
);

test.each(['alice:example.org', '@:example.org', '@alice:', '@a b:example.org', '@a:some host'])(
  'rejects an incomplete or whitespace-containing user ID: %s',
  (value) => {
    expect(isUserId(value)).toBe(false);
  }
);
