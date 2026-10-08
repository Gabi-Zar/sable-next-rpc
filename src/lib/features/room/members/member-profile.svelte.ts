import type { PerMessageProfileView, ProfileView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { ExpiryTimer, nextExpiry, parseRichPresences } from '#lib/profile/rich-presence.js';
import { PROFILE_RETRY_DELAYS_MS } from '#lib/profile/user-profile.svelte.js';

export class MemberProfile {
  open = $state(false);
  userId = $state<string | null>(null);
  anchor = $state<HTMLElement | null>(null);
  profile = $state<ProfileView | null>(null);
  pmp = $state<PerMessageProfileView | null>(null);
  failed = $state(false);
  #request = 0;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #unsubscribe: (() => void) | null = null;
  readonly #expiry = new ExpiryTimer();

  constructor(
    private readonly core: Pick<
      CoreClient,
      'userProfile' | 'refreshUserProfile' | 'onProfileChanged'
    >
  ) {}

  close(): void {
    this.#request += 1;
    this.#stop();
    this.open = false;
    this.userId = null;
    this.anchor = null;
    this.profile = null;
    this.failed = false;
  }

  showPmp(userId: string, anchor: HTMLElement, pmp: PerMessageProfileView): void {
    void this.show(userId, anchor);
    this.pmp = pmp;
  }

  async show(userId: string, anchor: HTMLElement): Promise<void> {
    const request = ++this.#request;
    this.#stop();
    this.userId = userId;
    this.anchor = anchor;
    this.open = true;
    this.profile = null;
    this.pmp = null;
    this.failed = false;
    this.#unsubscribe = this.core.onProfileChanged((changed) => {
      if (changed !== userId) return;
      this.#clearRetry();
      void this.#load(userId, request, 0, false);
    });
    // Rich presences have no push channel, so opening the card asks the server again rather than
    // trusting a cached profile.
    await this.#load(userId, request, 0, true);
  }

  async #load(userId: string, request: number, attempt: number, fresh: boolean): Promise<void> {
    try {
      const profile = fresh
        ? await this.core.refreshUserProfile(userId)
        : await this.core.userProfile(userId, true);
      if (request !== this.#request) return;
      this.profile = profile;
      this.failed = false;
      this.#watchExpiry(userId, request, profile);
    } catch (error) {
      console.warn('[sable profile] loading profile failed', error);
      if (request !== this.#request) return;
      this.failed = true;
      if (attempt >= PROFILE_RETRY_DELAYS_MS.length) return;
      this.#retry = setTimeout(() => {
        void this.#load(userId, request, attempt + 1, false);
      }, PROFILE_RETRY_DELAYS_MS[attempt]);
    }
  }

  /** Once the nearest presence expires, fetch again to pick up whatever replaces it. */
  #watchExpiry(userId: string, request: number, profile: ProfileView): void {
    this.#expiry.arm(nextExpiry(parseRichPresences(profile.extra)), () => {
      void this.#refreshAtExpiry(userId, request);
    });
  }

  // Not `#load`: a refresh invalidates the cached profile, which notifies the listener above, and
  // that listener loads through `#load`. Refreshing from there would loop.
  async #refreshAtExpiry(userId: string, request: number): Promise<void> {
    if (request !== this.#request) return;
    try {
      const profile = await this.core.refreshUserProfile(userId);
      if (request !== this.#request) return;
      this.profile = profile;
      this.#watchExpiry(userId, request, profile);
    } catch {
      // The card keeps the profile it has; the expired presences are already hidden by the view.
    }
  }

  #clearRetry(): void {
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
  }

  #stop(): void {
    this.#clearRetry();
    this.#expiry.clear();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
