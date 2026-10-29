import type { CoreClient } from '#lib/core/client.svelte.js';
import { RoomTimeline, type BackwardPaginationState } from '#lib/rooms/timeline.svelte.js';

import { ThreadRoots } from '#lib/rooms/thread-roots.svelte.js';

import { collectForumThreads, type ForumThread } from './forum-threads';

export class ForumThreads {
  private readonly timeline: RoomTimeline;
  private readonly roots: ThreadRoots;

  constructor(private readonly core: CoreClient) {
    this.timeline = new RoomTimeline(core);
    this.roots = new ThreadRoots(core);
  }

  readonly threads: ForumThread[] = $derived.by(() =>
    collectForumThreads(
      [...this.timeline.items, ...this.roots.items],
      this.core.session?.user_id ?? null,
      this.roots.latest,
      this.roots.unread
    )
  );

  get loading(): boolean {
    return this.timeline.loading || this.roots.loading;
  }

  get canLoadMore(): boolean {
    return this.roots.nextBatch !== null || this.timeline.backwardPagination !== 'end';
  }

  get error(): boolean {
    return this.timeline.error !== null || this.roots.error;
  }

  async retry(): Promise<void> {
    await Promise.all([this.timeline.retry(), this.roots.retry()]);
  }

  get backwardPagination(): BackwardPaginationState {
    return this.timeline.backwardPagination;
  }

  get roomTimeline(): RoomTimeline {
    return this.timeline;
  }

  async start(roomId: string): Promise<void> {
    await Promise.all([this.timeline.start(roomId), this.roots.start(roomId)]);
  }

  stop(): Promise<void> {
    this.roots.stop();
    return this.timeline.stop();
  }

  paginateBackward(count = 30): Promise<boolean> {
    return Promise.all([this.timeline.paginateBackward(count), this.roots.loadMore()]).then(
      ([end]) => end
    );
  }
}
