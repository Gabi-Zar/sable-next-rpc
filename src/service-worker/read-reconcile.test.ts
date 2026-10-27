import { expect, test } from 'vitest';

import { roomsToReconcile } from './read-reconcile';

test('reconciles the account’s other shown rooms once each', () => {
  expect(
    roomsToReconcile(
      [
        { data: { userId: '@me:example.org', roomId: '!read:example.org' } },
        { data: { userId: '@me:example.org', roomId: '!current:example.org' } },
        { data: { userId: '@other:example.org', roomId: '!other:example.org' } },
        { data: { userId: '@me:example.org', roomId: '!read:example.org' } },
      ],
      '@me:example.org',
      '!current:example.org'
    )
  ).toEqual(['!read:example.org']);
});
