import type { Attachment } from 'svelte/attachments';
import { SvelteMap } from 'svelte/reactivity';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { useCoreClient } from '#lib/core/context.js';

import {
  activePresences,
  ExpiryTimer,
  nextExpiry,
  parseRichPresences,
  type RichPresence,
} from './rich-presence.js';

type PresenceCore = Pick<CoreClient, 'userProfile' | 'refreshUserProfile' | 'onProfileChanged'>;

interface Watch {
  refs: number;
  timer: ExpiryTimer;
  request: number;
}

const NONE: readonly RichPresence[] = [];

/**
 * Rich presences of the users that are currently on screen in dense lists (member rows, direct
 * messages). The profile card does not use this: it reads the profile it already holds.
 *
 * Profiles themselves still come from the core client's cache. What this adds is the spec's
 * view-side refresh: a watched user is dropped from view and re-fetched as soon as the nearest
 * `expiry` of their presences passes, since a profile field has no push mechanism.
 */
export class RichPresenceStore {
  readonly #presences = new SvelteMap<string, readonly RichPresence[]>();
  // Deliberately not reactive: `watch` runs inside effects, and reading a reactive map there would
  // make the effect depend on the entry it is about to write.
  /* eslint-disable svelte/prefer-svelte-reactivity */
  readonly #watched = new Map<string, Watch>();
  /* eslint-enable svelte/prefer-svelte-reactivity */
  #unsubscribe: (() => void) | null = null;

  constructor(private readonly core: PresenceCore) {}

  /** Live presences of a user. Reactive, and only meaningful while the user is watched. */
  presences(userId: string): readonly RichPresence[] {
    return this.#presences.get(userId) ?? NONE;
  }

  /**
   * Starts following a user. The returned function stops following, and is meant to be returned
   * from an `$effect` so that rows going off screen release their user.
   */
  watch(userId: string): () => void {
    let entry = this.#watched.get(userId);
    if (!entry) {
      entry = { refs: 0, timer: new ExpiryTimer(), request: 0 };
      this.#watched.set(userId, entry);
    }
    entry.refs += 1;
    if (entry.refs === 1) {
      this.#subscribe();
      void this.#load(userId, false);
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#release(userId);
    };
  }

  #release(userId: string): void {
    const entry = this.#watched.get(userId);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    entry.timer.clear();
    this.#watched.delete(userId);
    this.#presences.delete(userId);
    if (this.#watched.size === 0) {
      this.#unsubscribe?.();
      this.#unsubscribe = null;
    }
  }

  /** Profiles invalidated elsewhere (profile card refresh, sync) are re-read from the cache. */
  #subscribe(): void {
    this.#unsubscribe ??= this.core.onProfileChanged((userId) => {
      if (this.#watched.has(userId)) void this.#load(userId, false);
    });
  }

  async #load(userId: string, force: boolean): Promise<void> {
    const entry = this.#watched.get(userId);
    if (!entry) return;
    const request = ++entry.request;
    try {
      const profile = force
        ? await this.core.refreshUserProfile(userId)
        : await this.core.userProfile(userId);
      if (this.#watched.get(userId) !== entry || request !== entry.request) return;
      this.#apply(userId, entry, parseRichPresences(profile.extra));
    } catch {
      // Keep what is on screen: the expiry timer still removes entries that go stale.
    }
  }

  #apply(userId: string, entry: Watch, presences: readonly RichPresence[]): void {
    if (presences.length === 0) this.#presences.delete(userId);
    else this.#presences.set(userId, presences);
    entry.timer.arm(nextExpiry(presences), () => {
      this.#expired(userId, entry);
    });
  }

  #expired(userId: string, entry: Watch): void {
    if (this.#watched.get(userId) !== entry) return;
    // Stop showing what is stale right away, then look for a successor.
    this.#apply(userId, entry, activePresences(this.#presences.get(userId) ?? NONE, Date.now()));
    void this.#load(userId, true);
  }
}

const stores = new WeakMap<object, RichPresenceStore>();

/** The rich presence store of the signed-in client. Call during component initialisation. */
export function useRichPresence(): RichPresenceStore {
  const core = useCoreClient();
  let store = stores.get(core);
  if (!store) {
    store = new RichPresenceStore(core);
    stores.set(core, store);
  }
  return store;
}

/**
 * Follows a user's rich presences while the element is near the viewport and lets go when it
 * scrolls away or is removed, so long lists only keep the visible rows warm.
 */
export function richPresenceWhenVisible(
  store: RichPresenceStore,
  userId: string,
  rootMargin = '300px'
): Attachment<HTMLElement> {
  return (node) => {
    let release: (() => void) | null = null;
    const start = () => {
      release ??= store.watch(userId);
    };
    const stop = () => {
      release?.();
      release = null;
    };

    if (typeof IntersectionObserver === 'undefined') {
      start();
      return stop;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.at(-1)?.isIntersecting) start();
        else stop();
      },
      { rootMargin }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      stop();
    };
  };
}
