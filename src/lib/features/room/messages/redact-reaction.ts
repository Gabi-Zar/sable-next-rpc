import type { CoreClient } from '#lib/core/client.svelte.js';
import { isRecord } from '#lib/guards.js';

export async function fetchReaction(
  core: Pick<CoreClient, 'rpc'>,
  roomId: string,
  eventId: string,
  key: string,
  sender: string
): Promise<Set<string>> {
  const eventIds = new Set<string>();
  const seenPages = new Set<string>();
  let from: string | undefined;
  do {
    const page = await core.rpc.timeline.roomEventRelations({
      room_id: roomId,
      event_id: eventId,
      rel_type: 'm.annotation',
      event_type: 'm.reaction',
      from: from ?? null,
      to: null,
      limit: 100,
      direction: null,
    });
    for (const event of page.chunk) {
      if (
        !isRecord(event) ||
        event.type !== 'm.reaction' ||
        event.sender !== sender ||
        typeof event.event_id !== 'string' ||
        !isRecord(event.content)
      )
        continue;
      const relation = event.content['m.relates_to'];
      if (
        isRecord(relation) &&
        relation.rel_type === 'm.annotation' &&
        relation.event_id === eventId &&
        relation.key === key
      )
        eventIds.add(event.event_id);
    }
    from = page.next_batch ?? undefined;
    if (from !== undefined) {
      if (seenPages.has(from)) throw new Error('Reaction pagination did not advance');
      seenPages.add(from);
    }
  } while (from !== undefined);

  return eventIds;
}

export async function redactReaction(
  core: Pick<CoreClient, 'rpc'>,
  roomId: string,
  eventId: string,
  key: string,
  sender: string
): Promise<void> {
  const eventIds = await fetchReaction(core, roomId, eventId, key, sender);
  for (const reactionId of eventIds) {
    await core.rpc.messages.sendRedaction({ room_id: roomId, event_id: reactionId, reason: null });
  }
}
