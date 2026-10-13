import { SvelteMap } from 'svelte/reactivity';

import type { CoreClient } from '#lib/core/client.svelte.js';

export interface AccountIdentity {
  displayName: string;
  avatarUrl: string | null;
}

export class AccountDirectory {
  #core: CoreClient;
  #identities = new SvelteMap<string, AccountIdentity>();
  // Nothing renders from this; it only stops a second request in flight.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  #requested = new Set<string>();

  constructor(core: CoreClient) {
    this.#core = core;
  }

  identity(userId: string): AccountIdentity {
    const key = `${this.#core.session?.account_id ?? ''}\n${userId}`;
    const known = this.#identities.get(key);
    if (known) return known;

    void this.#request(key, userId);
    return { displayName: userId, avatarUrl: null };
  }

  async #request(key: string, userId: string): Promise<void> {
    if (this.#requested.has(key)) return;
    this.#requested.add(key);

    try {
      const profile = await this.#core.userProfile(userId);
      this.#identities.set(key, {
        displayName: profile.display_name ?? userId,
        avatarUrl: profile.avatar_url,
      });
    } catch (error) {
      console.debug('[sable nav] account profile unavailable', error);
      // Let a later render retry; the core throttles repeat failures.
      this.#requested.delete(key);
    }
  }
}
