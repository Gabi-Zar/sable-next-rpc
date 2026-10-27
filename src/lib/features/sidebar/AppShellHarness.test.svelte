<script lang="ts">
  import { untrack } from 'svelte';
  import type { CoreClient } from '#lib/core/client.svelte.js';
  import { provideRoomList, RoomList } from '#lib/rooms/room-list.svelte.js';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import { provideAlertProviders } from './alerts.js';
  import AppShell from './AppShell.svelte';

  let { core }: { core: CoreClient } = $props();
  provideRoomList(untrack(() => new RoomList(core)));
  provideAlertProviders([]);
</script>

<div class="viewport">
  <TooltipProvider>
    <AppShell><button type="button">Page content</button></AppShell>
  </TooltipProvider>
</div>

<style>
  .viewport {
    inset: 0;
    position: fixed;
  }
</style>
