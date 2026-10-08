import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ProfileView } from '#src/generated/protocol';

import { RichPresenceStore } from './rich-presence.svelte';

const NOW = 1_800_000_000_000;
const USER = '@alice:example.com';

function profileWith(...presences: { id: string; name: string; expiry: number }[]): ProfileView {
  return {
    extra: [
      {
        key: 'm.rpc',
        value: JSON.stringify(presences.map((p) => ({ ...p, type: 'm.rpc.activity' }))),
      },
    ],
  } as unknown as ProfileView;
}

function setup(initial: ProfileView) {
  let listener: ((userId: string) => void) | null = null;
  const unsubscribe = vi.fn();
  const core = {
    userProfile: vi.fn().mockResolvedValue(initial),
    refreshUserProfile: vi.fn().mockResolvedValue(initial),
    onProfileChanged: vi.fn((next: (userId: string) => void) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return {
    core,
    unsubscribe,
    store: new RichPresenceStore(core),
    changed: (userId: string) => listener?.(userId),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

test('loads the presences of a watched user from the cached profile', async () => {
  const { store, core } = setup(profileWith({ id: 'a', name: 'Chess', expiry: NOW + 60_000 }));
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);

  expect(core.userProfile).toHaveBeenCalledWith(USER);
  expect(core.refreshUserProfile).not.toHaveBeenCalled();
  expect(store.presences(USER).map((p) => p.id)).toEqual(['a']);
  release();
});

test('hides a presence at its expiry and fetches again for a successor', async () => {
  const { store, core } = setup(profileWith({ id: 'a', name: 'Chess', expiry: NOW + 10_000 }));
  core.refreshUserProfile.mockResolvedValue(
    profileWith({ id: 'b', name: 'Go', expiry: NOW + 70_000 })
  );
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(9_000);
  expect(core.refreshUserProfile).not.toHaveBeenCalled();
  expect(store.presences(USER).map((p) => p.id)).toEqual(['a']);

  await vi.advanceTimersByTimeAsync(2_000);
  expect(core.refreshUserProfile).toHaveBeenCalledOnce();
  expect(store.presences(USER).map((p) => p.id)).toEqual(['b']);
  release();
});

test('an expired presence is dropped even when the re-fetch fails', async () => {
  const { store, core } = setup(profileWith({ id: 'a', name: 'Chess', expiry: NOW + 10_000 }));
  core.refreshUserProfile.mockRejectedValue(new Error('offline'));
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(11_000);
  expect(core.refreshUserProfile).toHaveBeenCalledOnce();
  expect(store.presences(USER)).toEqual([]);
  release();
});

test('a presence that is not replaced is not fetched for again and again', async () => {
  const { store, core } = setup(profileWith({ id: 'a', name: 'Chess', expiry: NOW + 10_000 }));
  core.refreshUserProfile.mockResolvedValue(
    profileWith({ id: 'a', name: 'Chess', expiry: NOW + 10_000 })
  );
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(120_000);
  expect(core.refreshUserProfile).toHaveBeenCalledOnce();
  expect(store.presences(USER)).toEqual([]);
  release();
});

test('releasing the last watcher stops the timer and forgets the user', async () => {
  const { store, core, unsubscribe } = setup(
    profileWith({ id: 'a', name: 'Chess', expiry: NOW + 10_000 })
  );
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);
  release();
  release();

  await vi.advanceTimersByTimeAsync(60_000);
  expect(core.refreshUserProfile).not.toHaveBeenCalled();
  expect(store.presences(USER)).toEqual([]);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('several watchers share one load and the user is kept until the last one lets go', async () => {
  const { store, core } = setup(profileWith({ id: 'a', name: 'Chess', expiry: NOW + 60_000 }));
  const first = store.watch(USER);
  const second = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);
  expect(core.userProfile).toHaveBeenCalledOnce();

  first();
  expect(store.presences(USER)).toHaveLength(1);
  second();
  expect(store.presences(USER)).toEqual([]);
});

test('re-reads a watched profile when it is invalidated elsewhere, and ignores strangers', async () => {
  const { store, core, changed } = setup(profileWith());
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.presences(USER)).toEqual([]);

  core.userProfile.mockResolvedValue(profileWith({ id: 'a', name: 'Chess', expiry: NOW + 60_000 }));
  changed('@bob:example.com');
  await vi.advanceTimersByTimeAsync(0);
  expect(core.userProfile).toHaveBeenCalledOnce();

  changed(USER);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.presences(USER).map((p) => p.id)).toEqual(['a']);
  release();
});

test('a profile that fails to load leaves the user with no presences', async () => {
  const { store, core } = setup(profileWith());
  core.userProfile.mockRejectedValue(new Error('offline'));
  const release = store.watch(USER);
  await vi.advanceTimersByTimeAsync(0);
  expect(store.presences(USER)).toEqual([]);
  release();
});
