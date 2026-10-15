import { expect, test, vi } from 'vitest';

import type { ProfileView } from '#src/generated/protocol';

import { DisplayNames } from './display-names.svelte';

test('shows the localpart until the profile resolves, then the display name', async () => {
  const userProfile = vi.fn(() =>
    Promise.resolve({ user_id: '@ada:example.org', display_name: 'Ada Lovelace' } as ProfileView)
  );
  const names = new DisplayNames({ userProfile });

  expect(names.name('@ada:example.org')).toBe('ada');
  await vi.waitFor(() => {
    expect(names.name('@ada:example.org')).toBe('Ada Lovelace');
  });
  expect(userProfile).toHaveBeenCalledOnce();
});

test('keeps the localpart when the profile has no name or fails', async () => {
  const names = new DisplayNames({ userProfile: vi.fn(() => Promise.reject(new Error('gone'))) });

  names.name('@bot:example.org');
  await Promise.resolve();

  expect(names.name('@bot:example.org')).toBe('bot');
});

test('asks again after a failed lookup, up to three times', async () => {
  const userProfile = vi.fn(() => Promise.reject(new Error('gone')));
  const names = new DisplayNames({ userProfile });

  for (let call = 0; call < 5; call += 1) {
    names.name('@ghost:example.org');
    await Promise.resolve();
    await Promise.resolve();
  }

  expect(userProfile).toHaveBeenCalledTimes(3);
});

test('resolves the name on a retry after one failure', async () => {
  const userProfile = vi
    .fn<() => Promise<ProfileView>>()
    .mockRejectedValueOnce(new Error('cold'))
    .mockResolvedValue({ user_id: '@ada:example.org', display_name: 'Ada' } as ProfileView);
  const names = new DisplayNames({ userProfile });

  names.name('@ada:example.org');
  await Promise.resolve();
  await Promise.resolve();
  names.name('@ada:example.org');

  await vi.waitFor(() => {
    expect(names.name('@ada:example.org')).toBe('Ada');
  });
});
