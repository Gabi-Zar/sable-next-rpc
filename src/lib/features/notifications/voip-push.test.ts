// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

import type { CoreClient } from '#lib/core/client.svelte.js';

import { unregisterVoipPusher } from './voip-push';

const removePusher = vi.fn(() => Promise.resolve());
const core = {
  rpc: { push: { removePusher } },
  session: { user_id: '@a:example.org' },
} as unknown as CoreClient;

function registerOld(userId = '@a:example.org'): void {
  localStorage.setItem(
    'sable.push.voip',
    JSON.stringify({ userId, appId: 'moe.sable.app.voip', pushkey: 'voip-1' })
  );
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

test('removes a VoIP pusher an older build registered, once', async () => {
  registerOld();
  await unregisterVoipPusher(core);
  await unregisterVoipPusher(core);

  expect(removePusher).toHaveBeenCalledOnce();
  expect(removePusher).toHaveBeenCalledWith({ pushkey: 'voip-1', app_id: 'moe.sable.app.voip' });
});

test('waits for the account that owns the VoIP pusher', async () => {
  registerOld('@b:example.org');
  await unregisterVoipPusher(core);

  expect(removePusher).not.toHaveBeenCalled();
  expect(localStorage.getItem('sable.push.voip')).not.toBeNull();
});

test('retries a removal that failed', async () => {
  registerOld();
  removePusher.mockRejectedValueOnce(new Error('offline'));
  await unregisterVoipPusher(core);
  await unregisterVoipPusher(core);

  expect(removePusher).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem('sable.push.voip')).toBeNull();
});

test('does nothing without a registered VoIP pusher', async () => {
  await unregisterVoipPusher(core);

  expect(removePusher).not.toHaveBeenCalled();
});
