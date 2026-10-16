import { createContext } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
import type { TimelineItemView, Rpc } from '#src/generated/protocol';

export type EventItemCommands = Pick<Rpc['timeline'], 'eventItems'>;

export const MAX_EVENT_ITEMS = 512;
const RETRY_DELAYS_MS = [1000, 5000, 15000];

class EventItemSlot {
  value = $state.raw<TimelineItemView | null | undefined>(undefined);
  pending = $state(false);
  watched = false;
  readonly watch = createSubscriber(() => {
    this.watched = true;
    return () => {
      this.watched = false;
    };
  });
}

export class EventItems {
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- each slot is its own signal
  readonly #items = new Map<string, EventItemSlot>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a request queue nothing renders from
  readonly #queued = new Map<string, Set<string>>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- retry bookkeeping nothing renders from
  readonly #failures = new Map<string, number>();
  #flushing = false;

  constructor(
    private readonly commands: EventItemCommands,
    private readonly owner: () => string | null
  ) {}

  #key(roomId: string, eventId: string, owner = this.owner()): string {
    return `${owner ?? ''}\n${roomId}\n${eventId}`;
  }

  #slot(key: string): EventItemSlot {
    let slot = this.#items.get(key);
    if (slot) {
      this.#items.delete(key);
    } else {
      slot = new EventItemSlot();
      this.#evict();
    }
    this.#items.set(key, slot);
    return slot;
  }

  #evict(): void {
    if (this.#items.size < MAX_EVENT_ITEMS) return;
    for (const [key, slot] of this.#items) {
      if (slot.watched) continue;
      this.#items.delete(key);
      this.#failures.delete(key);
      return;
    }
  }

  get(roomId: string, eventId: string): TimelineItemView | null | undefined {
    const slot = this.#slot(this.#key(roomId, eventId));
    slot.watch();
    const found = slot.value;
    if (found === undefined) this.#request(roomId, eventId);
    return found;
  }

  pending(roomId: string, eventId: string): boolean {
    return this.#items.get(this.#key(roomId, eventId))?.pending ?? false;
  }

  peek(roomId: string, eventId: string): TimelineItemView | null {
    return this.#items.get(this.#key(roomId, eventId))?.value ?? null;
  }

  put(roomId: string, items: readonly TimelineItemView[]): void {
    for (const item of items) {
      if (item.event_id !== null) this.#slot(this.#key(roomId, item.event_id)).value = item;
    }
  }

  #request(roomId: string, eventId: string): void {
    let queued = this.#queued.get(roomId);
    if (!queued) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- part of the request queue
      queued = new Set();
      this.#queued.set(roomId, queued);
    }
    queued.add(eventId);
    if (this.#flushing) return;
    this.#flushing = true;
    queueMicrotask(() => {
      this.#flushing = false;
      void this.#flush();
    });
  }

  #retryLater(key: string): void {
    const attempt = this.#failures.get(key) ?? 0;
    if (attempt >= RETRY_DELAYS_MS.length) {
      const slot = this.#items.get(key);
      if (slot) slot.pending = false;
      return;
    }
    this.#failures.set(key, attempt + 1);
    setTimeout(() => {
      const slot = this.#items.get(key);
      if (slot?.value === null) slot.value = undefined;
    }, RETRY_DELAYS_MS[attempt]);
  }

  async #flush(): Promise<void> {
    const batches = [...this.#queued];
    this.#queued.clear();
    const owner = this.owner();
    await Promise.all(
      batches.map(async ([roomId, ids]) => {
        const wanted = [...ids].filter(
          (id) => this.#items.get(this.#key(roomId, id, owner))?.value === undefined
        );
        if (wanted.length === 0) return;
        for (const id of wanted) {
          const slot = this.#slot(this.#key(roomId, id, owner));
          slot.value = null;
          slot.pending = true;
        }
        // eslint-disable-next-line svelte/prefer-svelte-reactivity -- tracks this request's misses only
        const missing = new Set(wanted);
        try {
          const items = await this.commands.eventItems({ room_id: roomId, event_ids: wanted });
          for (const item of items) {
            if (item.event_id === null) continue;
            const key = this.#key(roomId, item.event_id, owner);
            const slot = this.#slot(key);
            slot.value = item;
            slot.pending = false;
            this.#failures.delete(key);
            missing.delete(item.event_id);
          }
        } catch (error) {
          console.debug('[sable room] event items unavailable', error);
        }
        for (const id of missing) this.#retryLater(this.#key(roomId, id, owner));
      })
    );
  }
}

export const [useEventItems, provideEventItems] = createContext<EventItems>();
