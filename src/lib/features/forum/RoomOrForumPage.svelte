<script lang="ts">
  import { page } from '$app/state';

  import { useCoreClient } from '#lib/core/context.js';
  import CalendarPage from '#lib/features/calendar/CalendarPage.svelte';
  import RoomPage from '#lib/features/room/RoomPage.svelte';
  import { setNativeOpenConversation } from '#lib/platform/native-notifications.js';
  import { findRoomByPathId, useRoomList } from '#lib/rooms/room-list.svelte.js';

  import ForumPage from './ForumPage.svelte';

  const core = useCoreClient();
  const roomList = useRoomList();

  let roomId = $derived(page.params.roomId ?? '');
  let room = $derived(findRoomByPathId(roomList.rooms, roomId));
  let eventTimeline = $derived(page.url.searchParams.get('timeline') === 'events');
  let userId = $derived(core.session?.user_id ?? null);
  let openRoomId = $derived(room?.room_id ?? null);

  $effect(() => {
    void setNativeOpenConversation(userId, openRoomId).catch(conversationNotSet);
    return () => {
      void setNativeOpenConversation(null, null).catch(conversationNotSet);
    };
  });

  function conversationNotSet(error: unknown): void {
    console.debug('[sable notifications] open conversation not set', error);
  }
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
