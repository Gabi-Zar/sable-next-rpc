// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import type { ProfileView } from '#src/generated/protocol';
import { MemberProfile } from './member-profile.svelte.js';

const onProfileChanged = () => () => {};

test('closing a profile prevents a pending failure from reopening or changing it', async () => {
  const request = Promise.withResolvers<ProfileView>();
  const profile = new MemberProfile({ userProfile: () => request.promise, onProfileChanged });
  const opening = profile.show('@old', document.createElement('button'));
  profile.close();
  request.reject(new Error('unavailable'));
  await opening;
  expect(profile.open).toBe(false);
  expect(profile.userId).toBeNull();
  expect(profile.anchor).toBeNull();
  expect(profile.failed).toBe(false);
});

test('a later profile remains selected when an earlier request completes', async () => {
  const old = Promise.withResolvers<ProfileView>();
  const next = { display_name: 'Next' } as ProfileView;
  const profile = new MemberProfile({
    userProfile: vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(next),
    onProfileChanged,
  });
  const anchor = document.createElement('button');
  const first = profile.show('@old', anchor);
  await profile.show('@next', anchor);
  old.resolve({ display_name: 'Old' } as ProfileView);
  await first;
  expect(profile.userId).toBe('@next');
  expect(profile.profile).toEqual(next);
  expect(profile.failed).toBe(false);
});

test('a failed lookup is retried on a backoff', async () => {
  vi.useFakeTimers();
  try {
    const next = { display_name: 'Next' } as ProfileView;
    const userProfile = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(next);
    const profile = new MemberProfile({ userProfile, onProfileChanged });
    await profile.show('@new', document.createElement('button'));
    expect(profile.failed).toBe(true);

    await vi.runAllTimersAsync();
    expect(profile.profile).toEqual(next);
    expect(profile.failed).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test('a profile change for the open member loads it again', async () => {
  let notify = (_userId: string) => {};
  const next = { display_name: 'Next' } as ProfileView;
  const userProfile = vi
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce(next);
  const profile = new MemberProfile({
    userProfile,
    onProfileChanged: (listener) => {
      notify = listener;
      return () => {};
    },
  });
  await profile.show('@new', document.createElement('button'));
  expect(profile.failed).toBe(true);

  notify('@other');
  expect(userProfile).toHaveBeenCalledTimes(1);
  notify('@new');
  await vi.waitFor(() => {
    expect(profile.profile).toEqual(next);
  });
  expect(profile.failed).toBe(false);
  profile.close();
});
