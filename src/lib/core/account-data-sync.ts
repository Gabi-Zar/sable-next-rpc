import type { CoreClient } from './client.svelte.js';

export class AccountDataSync {
  core: CoreClient | null = null;
  generation = 0;
  #stopEvents: (() => void) | null = null;

  constructor(
    private readonly eventTypes: readonly string[],
    private readonly pull: (generation: number) => Promise<void>
  ) {}

  start(core: CoreClient): void {
    const generation = ++this.generation;
    this.core = core;
    this.#stopEvents?.();
    this.#stopEvents = core.subscribeEvents((event) => {
      if (event.type === 'account_data_changed' && this.eventTypes.includes(event.event_type)) {
        void this.pull(generation);
      }
    });
    void this.pull(generation);
  }

  stop(): void {
    this.generation += 1;
    this.core = null;
    this.#stopEvents?.();
    this.#stopEvents = null;
  }
}
