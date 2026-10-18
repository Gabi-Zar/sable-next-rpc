import type { ProfileView } from '#src/generated/protocol';

import type { CoreClient } from '#lib/core/client.svelte.js';

type ProfileCore = Pick<
  CoreClient,
  'cachedUserProfile' | 'forgetProfileFailure' | 'onProfileChanged' | 'userProfile'
>;

export const PROFILE_RETRY_DELAYS_MS = [3000, 10_000, 30_000];

export class ProfileSlot {
  profile = $state.raw<ProfileView | null>(null);

  #userId: string | null = null;
  #paused = false;
  #generation = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #lookup: AbortController | null = null;

  constructor(
    private readonly core: ProfileCore,
    private readonly lookupDelayMs = 0,
    private readonly retryDelaysMs: readonly number[] = []
  ) {}

  get userId(): string | null {
    return this.#userId;
  }

  sync(userId: string | null, paused = false): void {
    if (this.#userId === userId && this.#paused === paused) return;
    this.#userId = userId;
    this.#paused = paused;
    this.profile = null;
    this.#load(0);
  }

  refresh(userId: string): void {
    if (userId === this.#userId) this.#load(0);
  }

  dispose(): void {
    this.#userId = null;
    this.#load(0);
  }

  #load(attempt: number): void {
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
    this.#lookup?.abort();
    this.#lookup = null;
    const generation = ++this.#generation;
    const userId = this.#userId;
    if (userId === null || this.#paused) return;
    if (attempt === 0) {
      const cached = this.core.cachedUserProfile(userId);
      if (cached !== null) {
        this.profile = cached;
        return;
      }
      // Keep known colors and pronouns visible while an expired profile refreshes.
      const stale = this.core.cachedUserProfile(userId, true);
      if (stale !== null) this.profile = stale;
      if (this.lookupDelayMs > 0) {
        this.#retry = setTimeout(() => {
          this.#fetch(userId, generation, attempt);
        }, this.lookupDelayMs);
      } else {
        this.#fetch(userId, generation, attempt);
      }
      return;
    }
    this.core.forgetProfileFailure(userId);
    this.#fetch(userId, generation, attempt);
  }

  #fetch(userId: string, generation: number, attempt: number): void {
    this.#retry = null;
    const lookup = new AbortController();
    this.#lookup = lookup;
    void this.core.userProfile(userId, false, lookup.signal).then(
      (profile) => {
        if (generation === this.#generation) this.profile = profile;
      },
      (error: unknown) => {
        if (generation !== this.#generation) return;
        console.debug('[sable profile] profile unavailable', userId, error);
        if (attempt >= this.retryDelaysMs.length) return;
        this.#retry = setTimeout(() => {
          this.#load(attempt + 1);
        }, this.retryDelaysMs[attempt]);
      }
    );
  }
}

/** A reactive profile that follows `userId` and refreshes on profile changes. Create during component init. */
export class UserProfile {
  readonly #slot: ProfileSlot;

  readonly #userId: () => string | null | undefined;

  constructor(core: ProfileCore, userId: () => string | null | undefined) {
    this.#userId = userId;
    const slot = (this.#slot = new ProfileSlot(core));
    $effect(() => {
      slot.sync(userId() ?? null);
    });
    $effect(() => {
      const stop = core.onProfileChanged((id) => {
        slot.refresh(id);
      });
      return () => {
        stop();
        slot.dispose();
      };
    });
  }

  get current(): ProfileView | null {
    const profile = this.#slot.profile;
    return this.#slot.userId === (this.#userId() ?? null) ? profile : null;
  }
}
