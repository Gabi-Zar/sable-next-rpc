import { afterEach, expect, test, vi } from 'vitest';
import type { CoreEvent } from '#src/generated/protocol';
import { createCoreStub } from '#lib/core/__mocks__/context.js';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { timelineItem } from '../../../tests/e2e/fixtures/timeline-items';
import { ThreadRoots } from './thread-roots.svelte';

afterEach(() => vi.useRealTimers());

function fixture() {
  let emit: (event: CoreEvent) => void = () => {};
  const unsubscribe = vi.fn();
  const core = {
    ...createCoreStub(),
    subscribeEvents(listener: (event: CoreEvent) => void) {
      emit = listener;
      return unsubscribe;
    },
  };
  core.rpc.timeline.eventItems.mockResolvedValue([]);
  core.rpc.timeline.unreadDiagnostics.mockResolvedValue({
    main: { unread: 0, notifying: 0, highlight: 0, receipt_event_id: null },
    server_notifications: 0,
    server_highlights: 0,
    threads: [],
  });
  const roots = new ThreadRoots(core as unknown as CoreClient);
  return {
    core,
    roots,
    unsubscribe,
    emit: (event: CoreEvent) => {
      emit(event);
    },
  };
}

test('updates cached roots on room changes, preserving loaded pages and deduplicating roots', async () => {
  vi.useFakeTimers();
  const { core, roots, emit, unsubscribe } = fixture();
  const a = timelineItem('a', 'First topic');
  const b = timelineItem('b', 'Second topic');
  const list = core.rpc.timeline.listThreads;
  list.mockResolvedValueOnce({ roots: [a], next_batch: 'page2' });
  list.mockResolvedValueOnce({ roots: [a, b], next_batch: null });
  await roots.start('!forum:example.test');
  await roots.loadMore();
  expect(roots.items.map((root) => root.id)).toEqual(['a', 'b']);
  const changed = {
    ...a,
    thread_summary: {
      num_replies: 3,
      latest_event_id: null,
      latest_body: 'New reply',
      latest_fallback: null,
    },
  };
  list.mockResolvedValueOnce({ roots: [changed], next_batch: 'page2' });
  list.mockResolvedValueOnce({ roots: [b], next_batch: null });
  emit({ type: 'threads_changed', room_id: '!other:example.test' });
  await vi.advanceTimersByTimeAsync(250);
  expect(list).toHaveBeenCalledTimes(2);
  emit({ type: 'threads_changed', room_id: '!forum:example.test' });
  emit({ type: 'threads_changed', room_id: '!forum:example.test' });
  await vi.advanceTimersByTimeAsync(250);
  expect(list).toHaveBeenCalledTimes(4);
  expect(roots.items[0]?.thread_summary?.num_replies).toBe(3);
  roots.stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test('a failed initial load is retryable and a stopped request cannot replace the next room', async () => {
  const { core, roots } = fixture();
  const list = core.rpc.timeline.listThreads;
  list.mockRejectedValueOnce(new Error('offline'));
  await roots.start('!first:example.test');
  expect(roots.error).toBe(true);
  list.mockResolvedValueOnce({ roots: [timelineItem('first', 'Recovered')], next_batch: null });
  await roots.retry();
  expect(roots.error).toBe(false);
  const pending = Promise.withResolvers<{
    roots: ReturnType<typeof timelineItem>[];
    next_batch: null;
  }>();
  list.mockReturnValueOnce(pending.promise);
  const old = roots.start('!old:example.test');
  list.mockResolvedValueOnce({ roots: [timelineItem('new', 'New room')], next_batch: null });
  await roots.start('!new:example.test');
  pending.resolve({ roots: [timelineItem('old', 'Old room')], next_batch: null });
  await old;
  expect(roots.items[0]?.id).toBe('new');
  roots.stop();
});

test('hydrates latest reply activity and explicit thread receipts without blocking the list', async () => {
  const { core, roots } = fixture();
  const topic = timelineItem('topic', 'Topic');
  topic.thread_summary = {
    num_replies: 2,
    latest_event_id: '$reply',
    latest_body: 'Reply',
    latest_fallback: null,
  };
  const reply = {
    ...timelineItem('reply', 'Reply'),
    event_id: '$reply',
    thread_root: topic.event_id,
  };
  core.rpc.timeline.listThreads.mockResolvedValue({ roots: [topic], next_batch: null });
  const latest = Promise.withResolvers<ReturnType<typeof timelineItem>[]>();
  core.rpc.timeline.eventItems.mockReturnValue(latest.promise);
  core.rpc.timeline.unreadDiagnostics.mockResolvedValue({
    main: { unread: 0, notifying: 0, highlight: 0, receipt_event_id: null },
    server_notifications: 0,
    server_highlights: 0,
    threads: [
      {
        root_event_id: topic.event_id ?? '',
        unread: 0,
        notifying: 0,
        highlight: 0,
        receipt_event_id: '$reply',
      },
    ],
  });
  await roots.start('!forum:example.test');
  expect(roots.loading).toBe(false);
  expect(roots.items).toHaveLength(1);
  latest.resolve([reply]);
  await vi.waitFor(() => {
    expect(roots.latest).toEqual([reply]);
  });
  expect(roots.unread.get(topic.event_id ?? '')).toBe(false);
  expect(core.rpc.timeline.unreadDiagnostics).toHaveBeenCalledWith({
    room_id: '!forum:example.test',
    thread_roots: [topic.event_id],
  });
  roots.stop();
});
