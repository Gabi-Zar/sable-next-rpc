<script lang="ts">
  import { onMount } from 'svelte';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';

  import { i18n } from '#lib/i18n.js';
  import DialogFrame from '#lib/ui/primitives/DialogFrame.svelte';
  import PanelHeader from '#lib/ui/primitives/PanelHeader.svelte';
  import PanelHeaderButton from '#lib/ui/primitives/PanelHeaderButton.svelte';
  import ResizeHandle from '#lib/ui/primitives/ResizeHandle.svelte';
  import { PanelWidth, remFromPixels } from '#lib/ui/panel-width.svelte.js';

  import SearchView from '../search/SearchView.svelte';
  import { scrollHint } from '#lib/ui/scroll-hint.js';

  interface Props {
    query: string;
    modal?: boolean;
    onClose: () => void;
  }

  let { query, modal = false, onClose }: Props = $props();

  const panelWidth = new PanelWidth('sable-room-search-width', 26, 16, 40);
  onMount(() => panelWidth.restore());
</script>

{#snippet body()}
  <aside
    class={['room-search', { modal }]}
    aria-label={i18n.t('common.searchMessages')}
    style:width={modal ? null : `${panelWidth.width}rem`}
  >
    {#if !modal}
      <ResizeHandle
        value={panelWidth.width}
        min={panelWidth.min}
        max={panelWidth.max}
        label={i18n.t('search.resize')}
        grow="left"
        step={1}
        fromPixels={remFromPixels}
        onResize={(next) => panelWidth.resize(next)}
        onCommit={() => panelWidth.commit()}
      />
    {/if}
    <PanelHeader title={i18n.t('common.searchMessages')}>
      {#snippet prefix()}
        <MagnifyingGlassIcon aria-hidden="true" />
      {/snippet}
      {#snippet suffix()}
        <PanelHeaderButton label={i18n.t('search.close')} onclick={onClose}>
          <XIcon />
        </PanelHeaderButton>
      {/snippet}
    </PanelHeader>
    <div class="room-search-body" {@attach scrollHint}>
      <SearchView panel initialQuery={query} />
    </div>
  </aside>
{/snippet}

{#if modal}
  <DialogFrame
    open
    onOpenChange={(open: boolean) => {
      if (!open) onClose();
    }}
    variant="drawer"
    label={i18n.t('common.searchMessages')}
  >
    {@render body()}
  </DialogFrame>
{:else}
  {@render body()}
{/if}

<style>
  .room-search {
    --ghost-hover: var(--bg-container-hover);
    --ghost-active: var(--bg-container-active);

    background: var(--bg-container);
    border-left: var(--border-width) solid var(--bg-container-line);
    color: var(--bg-on-container);
    display: grid;
    flex: 0 0 auto;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    position: relative;
    width: 26rem;
  }

  .room-search.modal {
    border-left: none;
    height: 100%;
    width: 100%;
  }

  .room-search :global(.resize-handle) {
    left: -0.25rem;
    z-index: 1;
  }

  .room-search-body {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--space-300);
  }
</style>
