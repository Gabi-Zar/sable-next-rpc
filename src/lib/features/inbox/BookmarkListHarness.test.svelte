<script lang="ts">
  import { useCoreClient } from '#lib/core/context.js';
  import { Bookmarks, provideBookmarks } from '#lib/rooms/bookmarks.svelte.js';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import { EventItems, provideEventItems } from '../room/messages/event-items.svelte.js';
  import { RoomScopes, provideRoomScopes } from '../room/messages/message-scope.svelte.js';
  import BookmarkList from './BookmarkList.svelte';

  const core = useCoreClient();
  provideBookmarks(new Bookmarks(core.rpc.account));
  provideEventItems(new EventItems(core.rpc.timeline, () => core.session?.account_id ?? null));
  provideRoomScopes(new RoomScopes(core));
</script>

<TooltipProvider>
  <BookmarkList standalone />
</TooltipProvider>
