import { untrack } from 'svelte';
import type { TimelineItemView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
import type { RoomMemberLoader } from '#lib/rooms/room-members.svelte.js';

export function latestMemberChangeId(items: readonly TimelineItemView[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const { content, event_id: eventId } = items[index];
    if (eventId && (content.kind === 'membership' || content.kind === 'profile_change')) {
      return eventId;
    }
  }
  return null;
}

export function refreshRoomMembers(
  core: Pick<CoreClient, 'rpc' | 'onProfileChanged'>,
  memberLoader: Pick<RoomMemberLoader, 'refresh'>,
  resolvedRoomId: () => string,
  items: () => readonly TimelineItemView[]
): void {
  const memberChangeKey = $derived(latestMemberChangeId(items()));

  $effect(() => {
    if (memberChangeKey === null) return;
    const activeRoomId = untrack(resolvedRoomId);
    void untrack(() =>
      memberLoader.refresh(activeRoomId, (roomId) =>
        core.rpc.members.list({ room_id: roomId, memberships: [] })
      )
    );
  });

  $effect(() =>
    core.onProfileChanged(() => {
      void memberLoader.refresh(resolvedRoomId(), (roomId) =>
        core.rpc.members.list({ room_id: roomId, memberships: [] })
      );
    })
  );
}
