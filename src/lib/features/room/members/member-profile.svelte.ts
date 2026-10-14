import type { PerMessageProfileView, ProfileView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
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

  constructor(private readonly core: Pick<CoreClient, 'userProfile' | 'onProfileChanged'>) {}

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
      void this.#load(userId, request, 0);
    });
    await this.#load(userId, request, 0);
  }

  async #load(userId: string, request: number, attempt: number): Promise<void> {
    try {
      const profile = await this.core.userProfile(userId, true);
      if (request !== this.#request) return;
      this.profile = profile;
      this.failed = false;
    } catch (error) {
      console.warn('[sable profile] loading profile failed', error);
      if (request !== this.#request) return;
      this.failed = true;
      if (attempt >= PROFILE_RETRY_DELAYS_MS.length) return;
      this.#retry = setTimeout(() => {
        void this.#load(userId, request, attempt + 1);
      }, PROFILE_RETRY_DELAYS_MS[attempt]);
    }
  }

  #clearRetry(): void {
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
  }

  #stop(): void {
    this.#clearRetry();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
