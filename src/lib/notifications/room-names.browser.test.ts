import { afterEach, expect, test } from 'vitest';

import {
  expectPushActivation,
  pendingPushActivations,
  pushContentPolicy,
  PUSH_ACTIVATION_TTL_MS,
  settlePushActivation,
} from './room-names.js';

test('missing push policy clears alerts by default', async () => {
  await expect(pushContentPolicy()).resolves.toMatchObject({ clearOnRead: true });
});

afterEach(async () => {
  await settlePushActivation('@me:example.org');
  await settlePushActivation('@alt:example.org');
});

test('a registered account awaits activation until its token would expire', async () => {
  await expectPushActivation('@me:example.org');

  await expect(pendingPushActivations(Date.now())).resolves.toEqual(['@me:example.org']);
  await expect(pendingPushActivations(Date.now() + PUSH_ACTIVATION_TTL_MS)).resolves.toEqual([]);
});

test('settling one account leaves the others pending', async () => {
  await expectPushActivation('@me:example.org');
  await expectPushActivation('@alt:example.org');

  await settlePushActivation('@me:example.org');

  await expect(pendingPushActivations(Date.now())).resolves.toEqual(['@alt:example.org']);
});
