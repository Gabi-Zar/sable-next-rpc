import type { RoomTimeline } from '#lib/rooms/timeline.svelte.js';
import type { TimelineItemView } from '#src/generated/protocol';

export class TimelineFuture {
  pending = $state(false);
  failed = $state(false);
  #task: Promise<void> | null = null;
  #requestedItems: readonly TimelineItemView[] | null = null;

  constructor(
    private readonly timeline: () => RoomTimeline,
    private readonly load: () => Promise<void>
  ) {}

  canRefill(): boolean {
    return !this.failed && this.timeline().items !== this.#requestedItems;
  }

  request(manual = false): Promise<void> {
    if (this.#task) return this.#task;
    if (manual) {
      this.failed = false;
      this.#requestedItems = null;
    }
    if (!this.canRefill()) return Promise.resolve();
    this.#requestedItems = this.timeline().items;
    this.pending = true;
    const task: Promise<void> = Promise.resolve()
      .then(() => (this.#task === task ? this.load() : undefined))
      .catch((error: unknown) => {
        if (this.#task === task) this.failed = true;
        throw error;
      })
      .finally(() => {
        if (this.#task !== task) return;
        this.#task = null;
        this.pending = false;
      });
    this.#task = task;
    return task;
  }

  reset(): void {
    this.#task = null;
    this.#requestedItems = null;
    this.pending = false;
    this.failed = false;
  }
}
