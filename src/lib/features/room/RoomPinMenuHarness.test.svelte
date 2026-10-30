<script lang="ts">
  import type { ComponentProps } from 'svelte';

  import { useCoreClient } from '#lib/core/context.js';
  import { Bookmarks, provideBookmarks } from '#lib/rooms/bookmarks.svelte.js';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';

  import { EventItems, provideEventItems } from './messages/event-items.svelte.js';
  import { RoomScopes, provideRoomScopes } from './messages/message-scope.svelte.js';
  import MediaViewer from '#lib/ui/media/MediaViewer.svelte';
  import RoomPinMenu from './RoomPinMenu.svelte';
  import { mediaViewerState } from '#lib/ui/media/media-viewer-state.svelte.js';

  let { menu }: { menu: ComponentProps<typeof RoomPinMenu> } = $props();
  const core = useCoreClient();
  provideEventItems(new EventItems(core.rpc.timeline, () => core.session?.account_id ?? null));
  provideRoomScopes(new RoomScopes(core));
  provideBookmarks(new Bookmarks(core.rpc.account));
</script>

<TooltipProvider>
  <RoomPinMenu {...menu} />
  {#if mediaViewerState.eventId}
    <MediaViewer />
  {/if}
</TooltipProvider>
