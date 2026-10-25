<script lang="ts">
  import { mediaViewerState } from '#lib/ui/media/media-viewer-state.svelte.ts';
  import MediaViewer from '#lib/ui/media/MediaViewer.svelte';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import AccountSwitcher from './AccountSwitcher.svelte';
</script>

<TooltipProvider>
  <AccountSwitcher mode="desktop" />
  {#if mediaViewerState.eventId}
    <MediaViewer />
  {/if}
</TooltipProvider>
