import { SvelteMap } from 'svelte/reactivity';

import type { CoreClient } from '#lib/core/client.svelte.js';
import type { TimelineItemView } from '#src/generated/protocol';

export class ThreadRoots {
  items = $state.raw<TimelineItemView[]>([]);
  latest = $state.raw<TimelineItemView[]>([]);
  unread = $state.raw<ReadonlyMap<string, boolean>>(new SvelteMap());
  loading = $state(false);
  error = $state(false);
  nextBatch = $state<string | null>(null);
  private roomId: string | null = null;
  private generation = 0;
  private pages = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;
  private pending = false;

  constructor(private readonly core: CoreClient) {}

  async start(roomId: string): Promise<void> {
    this.stop();
    this.roomId = roomId;
    this.items = [];
    this.latest = [];
    this.unread = new SvelteMap();
    this.nextBatch = null;
    this.pages = 1;
    this.unsubscribe = this.core.subscribeEvents((event) => {
      if (event.type === 'threads_changed' && event.room_id === roomId) this.refresh();
    });
    await this.load(false);
  }

  stop(): void {
    this.generation += 1;
    this.roomId = null;
    this.loading = false;
    this.pending = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  refresh(): void {
    if (this.timer !== undefined || this.roomId === null) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.loading) this.pending = true;
      else void this.load(false);
    }, 250);
  }

  retry(): Promise<void> {
    return this.load(false);
  }

  loadMore(): Promise<void> {
    return this.nextBatch === null ? Promise.resolve() : this.load(true);
  }

  private async load(more: boolean): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null || this.loading) return;
    const generation = ++this.generation;
    this.loading = true;
    this.error = false;
    try {
      let from = more ? this.nextBatch : null;
      const roots = more ? [...this.items] : [];
      const pages = more ? 1 : this.pages;
      for (let page = 0; page < pages; page += 1) {
        const response = await this.core.rpc.timeline.listThreads({ room_id: roomId, from });
        if (generation !== this.generation) return;
        roots.push(...response.roots);
        from = response.next_batch;
        if (from === null) break;
      }
      this.items = [
        ...new SvelteMap(roots.map((root) => [root.event_id ?? root.id, root])).values(),
      ];
      this.nextBatch = from;
      if (more) this.pages += 1;
      void this.hydrate(roomId, generation, this.items);
    } catch (error) {
      if (generation === this.generation) {
        this.error = true;
        console.warn('[sable threads] loading threads failed', error);
      }
    } finally {
      if (generation === this.generation) {
        this.loading = false;
        if (this.pending) {
          this.pending = false;
          this.refresh();
        }
      }
    }
  }

  private async hydrate(
    roomId: string,
    generation: number,
    roots: readonly TimelineItemView[]
  ): Promise<void> {
    const ids = roots.flatMap((root) =>
      root.thread_summary?.latest_event_id ? [root.thread_summary.latest_event_id] : []
    );
    const requests: Promise<TimelineItemView[]>[] = [];
    for (let start = 0; start < ids.length; start += 50) {
      requests.push(
        this.core.rpc.timeline.eventItems({
          room_id: roomId,
          event_ids: ids.slice(start, start + 50),
        })
      );
    }
    const [latest, read] = await Promise.allSettled([
      Promise.all(requests).then((batches) => batches.flat()),
      this.core.rpc.timeline.unreadDiagnostics({
        room_id: roomId,
        thread_roots: roots.flatMap((root) => (root.event_id ? [root.event_id] : [])),
      }),
    ]);
    if (generation !== this.generation) return;
    if (latest.status === 'fulfilled') this.latest = latest.value;
    if (read.status === 'fulfilled') {
      this.unread = new SvelteMap(
        read.value.threads
          .filter((thread) => thread.receipt_event_id !== null || thread.unread > 0)
          .map((thread) => [thread.root_event_id, thread.unread > 0])
      );
    }
  }
}
