<script lang="ts">
  import { i18n } from '#lib/i18n.ts';
  import { mediaViewerState } from '../media/media-viewer-state.svelte';
  import MediaImage from '../MediaImage.svelte';
  import Tooltip from './Tooltip.svelte';

  type Props = {
    source: string;
    name: string;
    width: number;
    height: number;
  };

  const { source, name, width, height }: Props = $props();
</script>

{#snippet bannerButtonTrigger({ props: tooltipProps }: { props: Record<string, unknown> })}
  <button
    {...tooltipProps}
    class="banner-button"
    type="button"
    aria-label={i18n.t('common.viewBanner', { name })}
    onclick={() => mediaViewerState.openStandalone(source, name)}
  >
    <MediaImage class="banner-image" {source} alt="" {width} {height} />
  </button>
{/snippet}

<Tooltip label={i18n.t('common.viewBanner', { name })} trigger={bannerButtonTrigger} />

<style>
  .banner-button {
    background: none;
    border: 0;
    cursor: pointer;
    display: block;
    height: 100%;
    overflow: hidden;
    padding: 0;
    width: 100%;
  }

  :global(.banner-image) {
    height: 100%;
    width: 100%;
  }
</style>
