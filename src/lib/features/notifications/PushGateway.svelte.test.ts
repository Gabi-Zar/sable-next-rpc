// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

vi.mock('#lib/core/context.js');
vi.mock('#lib/config/runtime-config.js', () => ({ runtimeConfig: () => Promise.resolve({}) }));
vi.mock('#lib/platform/push.js', () => ({
  supportsPushDistributors: vi.fn(() => Promise.resolve(true)),
  listPushDistributors: vi.fn(() => Promise.resolve(['ntfy', 'gotify'])),
}));
vi.mock('#lib/platform/notifications.js', () => ({
  deliversWebPush: () => false,
  deliversNativePush: () => true,
}));
vi.mock('./native-push.js', () => ({
  selectedPushDistributor: () => 'ntfy',
  selectedPushProvider: () => 'unifiedpush',
  switchPushDistributor: vi.fn(),
  switchPushProvider: vi.fn(),
}));

import { core } from '#lib/core/__mocks__/context.js';
import { switchPushDistributor } from './native-push.js';
import PushGateway from './PushGateway.svelte';

test('the distributor snaps back when switching fails', async () => {
  Object.assign(core, { status: 'ready' });
  vi.mocked(switchPushDistributor).mockRejectedValueOnce(new Error('native failure'));
  const user = userEvent.setup();
  render(PushGateway);

  const trigger = () => screen.getByRole('combobox', { name: 'Notification distributor' });
  await screen.findByRole('combobox', { name: 'Notification distributor' });
  expect(trigger()).toHaveTextContent('ntfy');

  await user.click(trigger());
  await user.click(await screen.findByRole('option', { name: 'gotify' }));

  expect(await screen.findByText(/Could not update the notification distributor/)).toBeVisible();
  expect(switchPushDistributor).toHaveBeenCalledWith('gotify', expect.anything(), null, []);
  expect(trigger()).toHaveTextContent('ntfy');
});
