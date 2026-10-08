// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import type { ProfileView } from '#src/generated/protocol';
import { MemberProfile } from './member-profile.svelte.js';

const NOW = 1_800_000_000_000;
const onProfileChanged = () => () => {};

// Opening a card refreshes the profile and every later load reads it, so one mock stands in for
// both and the call order the tests describe stays the same.
function coreOf(
  userProfile: () => Promise<ProfileView>,
  changed: (listener: (userId: string) => void) => () => void = onProfileChanged
) {
  return { userProfile, refreshUserProfile: userProfile, onProfileChanged: changed };
}

test('closing a profile prevents a pending failure from reopening or changing it', async () => {
  const request = Promise.withResolvers<ProfileView>();
  const profile = new MemberProfile(coreOf(() => request.promise));
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
  const profile = new MemberProfile(
    coreOf(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(next))
  );
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
    const profile = new MemberProfile(coreOf(userProfile));
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
  const profile = new MemberProfile(
    coreOf(userProfile, (listener) => {
      notify = listener;
      return () => {};
    })
  );
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

test('opening a card asks the server again instead of using the cache', async () => {
  const loaded = { display_name: 'Alice' } as ProfileView;
  const refreshUserProfile = vi.fn().mockResolvedValue(loaded);
  const userProfile = vi.fn();
  const profile = new MemberProfile({ userProfile, refreshUserProfile, onProfileChanged });
  await profile.show('@alice', document.createElement('button'));
  expect(refreshUserProfile).toHaveBeenCalledWith('@alice');
  expect(userProfile).not.toHaveBeenCalled();
  expect(profile.profile).toEqual(loaded);
  profile.close();
});

test('fetches the profile again when its rich presence expires', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const playing = {
      extra: [
        {
          key: 'm.rpc',
          value: JSON.stringify([
            { id: 'a', type: 'm.rpc.activity', name: 'Chess', expiry: NOW + 10_000 },
          ]),
        },
      ],
    } as ProfileView;
    const later = { display_name: 'Later' } as ProfileView;
    const refreshUserProfile = vi.fn().mockResolvedValueOnce(playing).mockResolvedValueOnce(later);
    const profile = new MemberProfile({
      userProfile: vi.fn(),
      refreshUserProfile,
      onProfileChanged,
    });
    await profile.show('@alice', document.createElement('button'));
    expect(profile.profile).toEqual(playing);

    await vi.advanceTimersByTimeAsync(9_000);
    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refreshUserProfile).toHaveBeenCalledTimes(2);
    expect(profile.profile).toEqual(later);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(refreshUserProfile).toHaveBeenCalledTimes(2);
    profile.close();
  } finally {
    vi.useRealTimers();
  }
});

test('closing the card stops the expiry refresh', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const playing = {
      extra: [
        {
          key: 'm.rpc',
          value: JSON.stringify([
            { id: 'a', type: 'm.rpc.activity', name: 'Chess', expiry: NOW + 10_000 },
          ]),
        },
      ],
    } as ProfileView;
    const refreshUserProfile = vi.fn().mockResolvedValue(playing);
    const profile = new MemberProfile({
      userProfile: vi.fn(),
      refreshUserProfile,
      onProfileChanged,
    });
    await profile.show('@alice', document.createElement('button'));
    profile.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
