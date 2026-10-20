// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('#lib/core/context.js');

const { rooms } = vi.hoisted(() => ({
  rooms: [] as { is_direct: boolean; is_tombstoned: boolean; direct_targets: string[] }[],
}));
vi.mock('#lib/rooms/room-list.svelte.js', async (importActual) => ({
  ...(await importActual<typeof import('#lib/rooms/room-list.svelte.js')>()),
  useRoomList: () => ({ rooms }),
}));

import { core } from '#lib/core/__mocks__/context.js';
import UserSecurityDialog from './UserSecurityDialog.svelte';

const userSecurity = vi.fn(() =>
  Promise.resolve({
    verification: 'unverified' as const,
    verification_violation: false,
    devices: [
      {
        device_id: 'SIGNED',
        display_name: 'Alice phone',
        verified: false,
        cross_signed: true,
        blocked: false,
      },
      {
        device_id: 'UNSIGNED',
        display_name: null,
        verified: false,
        cross_signed: false,
        blocked: true,
      },
    ],
  })
);
const requestVerification = vi.fn(() => Promise.resolve('flow'));

beforeEach(() => {
  vi.clearAllMocks();
  rooms.splice(0, rooms.length, {
    is_direct: true,
    is_tombstoned: false,
    direct_targets: ['@alice:example.org'],
  });
  Object.assign(core, { requestVerification });
  Object.assign(core.rpc.encryption, { userSecurity });
});

test('shows identity and MSC4153 device eligibility, then starts user verification', async () => {
  render(UserSecurityDialog, {
    props: {
      open: true,
      userId: '@alice:example.org',
      displayName: 'Alice',
      onOpenChange: vi.fn(),
    },
  });

  expect(await screen.findByRole('heading', { name: 'Encryption for Alice' })).toBeInTheDocument();
  expect(screen.getByText('Alice phone')).toBeInTheDocument();
  expect(screen.getByText('Not signed by owner')).toBeInTheDocument();
  expect(screen.getByText('Blocked')).toBeInTheDocument();

  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Verify identity' }));
  expect(requestVerification).toHaveBeenCalledWith('@alice:example.org');
});

test('asks before verifying someone it has no chat with', async () => {
  rooms.length = 0;
  render(UserSecurityDialog, {
    props: {
      open: true,
      userId: '@alice:example.org',
      displayName: 'Alice',
      onOpenChange: vi.fn(),
    },
  });
  const user = userEvent.setup();

  await user.click(await screen.findByRole('button', { name: 'Verify identity' }));
  expect(requestVerification).not.toHaveBeenCalled();

  const warning = await screen.findByText('Start a chat with Alice?');
  const confirm = warning.closest('[role="dialog"]');
  if (!(confirm instanceof HTMLElement)) throw new Error('no confirmation dialog');
  await user.click(within(confirm).getByRole('button', { name: 'Verify identity' }));
  expect(requestVerification).toHaveBeenCalledWith('@alice:example.org');
});

test('allows a long device list to scroll within the dialog', async () => {
  userSecurity.mockResolvedValueOnce({
    verification: 'unverified',
    verification_violation: false,
    devices: Array.from({ length: 30 }, (_, index) => ({
      device_id: `DEVICE-${index}`,
      display_name: `Device ${index}`,
      verified: false,
      cross_signed: true,
      blocked: false,
    })),
  });

  render(UserSecurityDialog, {
    props: {
      open: true,
      userId: '@alice:example.org',
      displayName: 'Alice',
      onOpenChange: vi.fn(),
    },
  });

  await screen.findByText('Device 29');
  const deviceList = screen.getByRole('list');
  const scrollRegion = deviceList.closest('.security-body');
  if (!scrollRegion) throw new Error('Expected a scroll region around the device list');
  expect(getComputedStyle(scrollRegion).overflowY).toBe('auto');
});
