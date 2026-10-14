import type { CoreClient } from '#lib/core/client.svelte.js';
import type { RoomMemberLoader } from '#lib/rooms/room-members.svelte.js';

export function refreshRoomMembers(
  core: Pick<CoreClient, 'rpc' | 'onProfileChanged' | 'subscribeEvents'>,
  memberLoader: Pick<RoomMemberLoader, 'refresh'>,
  resolvedRoomId: () => string
): void {
  const refresh = () =>
    memberLoader.refresh(resolvedRoomId(), (roomId) =>
      core.rpc.members.list({ room_id: roomId, memberships: [] })
    );

  $effect(() =>
    core.subscribeEvents((event) => {
      if (event.type === 'members_changed' && event.room_id === resolvedRoomId()) void refresh();
    })
  );

  $effect(() => core.onProfileChanged(() => void refresh()));
}
