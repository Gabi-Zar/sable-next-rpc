<script lang="ts">
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { savedSpacePaths, spaceIndexRedirect } from '#lib/features/sidebar/space-paths.js';
  import { findRoomByPathId, roomPathParam, useRoomList } from '#lib/rooms/room-list.svelte.js';
  import RoutePlaceholder from '#lib/ui/RoutePlaceholder.svelte';

  const roomList = useRoomList();
  let space = $derived(findRoomByPathId(roomList.rooms, page.params.spaceId));
  let spaceId = $derived(space?.room_id ?? null);

  $effect(() => {
    if (spaceId === null) return;

    const target = untrack(() => {
      if (!space) return null;
      const param = roomPathParam(space, roomList.rooms);
      return spaceIndexRedirect(
        resolve('/(app)/space/[spaceId]', { spaceId: param }),
        savedSpacePaths()[space.room_id],
        resolve('/(app)/space/[spaceId]/lobby', { spaceId: param }),
        (pathId) => findRoomByPathId(roomList.rooms, pathId)?.state === 'joined'
      );
    });
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- spaceIndexRedirect() picks among resolved paths
    if (target !== null) void goto(target, { replace: true });
  });
</script>

{#if spaceId === null}
  <RoutePlaceholder title={space?.name ?? page.params.spaceId} />
{/if}
