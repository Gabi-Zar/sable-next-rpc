import type { UserDirectoryEntryView } from '#src/generated/protocol';

import type { CoreClient } from '#lib/core/client.svelte.js';

export class UserDirectoryLookup {
  results = $state.raw<UserDirectoryEntryView[]>([]);
  searching = $state(false);

  #core: CoreClient;
  #run = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(core: CoreClient) {
    this.#core = core;
  }

  search(query: string): void {
    clearTimeout(this.#timer);
    const current = ++this.#run;
    this.searching = query !== '';
    if (!query) {
      this.results = [];
      return;
    }
    this.#timer = setTimeout(() => {
      void this.#find(query, current);
    }, 300);
  }

  cancel(): void {
    clearTimeout(this.#timer);
  }

  async #find(query: string, current: number): Promise<void> {
    try {
      const { results } = await this.#core.rpc.account.searchUserDirectory({
        term: query,
        limit: 10,
      });
      if (current === this.#run) this.results = results;
    } catch (error) {
      console.warn('[sable room] user directory unavailable', error);
      if (current === this.#run) this.results = [];
    } finally {
      if (current === this.#run) this.searching = false;
    }
  }
}
