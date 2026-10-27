<script lang="ts">
  import type { RoomMediaViewer } from '../room-media-viewer.svelte.js';
  import MediaViewer from './MediaViewer.svelte';

  interface Props {
    viewer: RoomMediaViewer;
    onJump?: (eventId: string) => void;
  }

  let { viewer, onJump }: Props = $props();
</script>

{#if viewer.eventId}
  <MediaViewer
    items={viewer.items}
    selectedEventId={viewer.eventId}
    onClose={() => viewer.close()}
    {onJump}
  />
{/if}
