<script lang="ts">
  import { page } from '$app/state';

  import CalendarPage from '#lib/features/calendar/CalendarPage.svelte';
  import RoomPage from '#lib/features/room/RoomPage.svelte';
  import { findRoomByPathId, useRoomList } from '#lib/rooms/room-list.svelte.js';

  import ForumPage from './ForumPage.svelte';

  const roomList = useRoomList();

  let roomId = $derived(page.params.roomId ?? '');
  let room = $derived(findRoomByPathId(roomList.rooms, roomId));
  let eventTimeline = $derived(page.url.searchParams.get('timeline') === 'events');
</script>

{#if eventTimeline}
  <RoomPage />
{:else if room?.room_kind === 'forum'}
  <ForumPage {roomId} />
{:else if room?.room_kind === 'calendar'}
  <CalendarPage {roomId} />
{:else}
  <RoomPage />
{/if}
