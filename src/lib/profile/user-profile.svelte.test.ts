// @vitest-environment happy-dom

import { flushSync } from 'svelte';
import { afterEach, expect, test, vi } from 'vitest';

import type { ProfileView } from '#src/generated/protocol';

import { UserProfile } from './user-profile.svelte.js';

function profile(userId: string): ProfileView {
  return { user_id: userId, display_name: userId } as ProfileView;
}

function fakeCore(cached: Map<string, ProfileView>) {
  return {
    cachedUserProfile: (userId: string) => cached.get(userId) ?? null,
    forgetProfileFailure: vi.fn(),
    onProfileChanged: () => () => {},
    userProfile: vi.fn((_userId: string): Promise<ProfileView> =>
      Promise.reject(new Error('unreachable'))
    ),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test('a failed lookup is not retried', async () => {
  vi.useFakeTimers();
  const core = fakeCore(new Map());
  const stop = $effect.root(() => {
    new UserProfile(core, () => '@gone:example.org');
  });
  flushSync();

  await vi.advanceTimersByTimeAsync(60_000);

  expect(core.userProfile).toHaveBeenCalledOnce();
  expect(core.forgetProfileFailure).not.toHaveBeenCalled();
  stop();
});

test('switching users never shows the previous profile', () => {
  const core = fakeCore(new Map([['@alice:example.org', profile('@alice:example.org')]]));
  let userId = $state('@alice:example.org');
  let shown!: UserProfile;
  const stop = $effect.root(() => {
    shown = new UserProfile(core, () => userId);
  });
  flushSync();
  expect(shown.current?.user_id).toBe('@alice:example.org');

  userId = '@bob:example.org';
  expect(shown.current).toBeNull();
  stop();
});

test('a reader updates once the new user profile loads', async () => {
  const core = fakeCore(new Map([['@alice:example.org', profile('@alice:example.org')]]));
  core.userProfile.mockImplementation((userId: string) => Promise.resolve(profile(userId)));
  let userId = $state('@alice:example.org');
  const seen: (string | undefined)[] = [];
  const stop = $effect.root(() => {
    const shown = new UserProfile(core, () => userId);
    $effect.pre(() => {
      seen.push(shown.current?.user_id);
    });
  });
  flushSync();

  userId = '@bob:example.org';
  flushSync();
  await vi.waitFor(() => {
    flushSync();
    expect(seen.at(-1)).toBe('@bob:example.org');
  });
  stop();
});
