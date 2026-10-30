<script lang="ts">
  import { onDestroy } from 'svelte';

  import MediaViewer from './MediaViewer.svelte';
  import { mediaViewerState } from './media-viewer-state.svelte.js';

  onDestroy(() => mediaViewerState.close());
</script>

{#if mediaViewerState.eventId}
  <MediaViewer />
{/if}
