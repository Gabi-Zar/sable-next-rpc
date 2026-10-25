<script lang="ts">
  import { mediaViewerState } from '#lib/ui/media/media-viewer-state.svelte.ts';
  import MediaViewer from '#lib/ui/media/MediaViewer.svelte';
  import AccountManager from './AccountManager.svelte';
</script>

<AccountManager />
{#if mediaViewerState.eventId}
  <MediaViewer />
{/if}
