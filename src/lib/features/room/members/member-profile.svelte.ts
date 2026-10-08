import type { PerMessageProfileView, ProfileView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { ExpiryTimer, nextExpiry, parseRichPresences } from '#lib/profile/rich-presence.js';

export class MemberProfile {
  open = $state(false);
  userId = $state<string | null>(null);
  anchor = $state<HTMLElement | null>(null);
  profile = $state<ProfileView | null>(null);
  pmp = $state<PerMessageProfileView | null>(null);
  failed = $state(false);
  #request = 0;
  readonly #expiry = new ExpiryTimer();

  constructor(private readonly core: Pick<CoreClient, 'refreshUserProfile'>) {}

  close(): void {
    this.#request += 1;
    this.#expiry.clear();
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
    this.#expiry.clear();
    this.userId = userId;
    this.anchor = anchor;
    this.open = true;
    this.profile = null;
    this.pmp = null;
    this.failed = false;
    try {
      // Rich presences have no push mechanism, so opening the card always asks the server again
      // rather than trusting a cached profile.
      const profile = await this.core.refreshUserProfile(userId);
      if (request !== this.#request) return;
      this.profile = profile;
      this.#watchExpiry(request, userId, profile);
    } catch {
      if (request === this.#request) this.failed = true;
    }
  }

  /** Once the nearest presence expires, fetch again to pick up whatever replaces it. */
  #watchExpiry(request: number, userId: string, profile: ProfileView): void {
    this.#expiry.arm(nextExpiry(parseRichPresences(profile.extra)), () => {
      void this.#refresh(request, userId);
    });
  }

  async #refresh(request: number, userId: string): Promise<void> {
    if (request !== this.#request) return;
    try {
      const profile = await this.core.refreshUserProfile(userId);
      if (request !== this.#request) return;
      this.profile = profile;
      this.#watchExpiry(request, userId, profile);
    } catch {
      // The card keeps the profile it has; the expired presences are already hidden by the view.
    }
  }
}
