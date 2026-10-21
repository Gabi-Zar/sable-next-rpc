<script lang="ts">
  import CloudXIcon from 'phosphor-svelte/lib/CloudXIcon';

  import { i18n } from '#lib/i18n.js';
  import { NON_SYNCABLE_KEYS } from '#lib/settings/sync.js';
  import Tooltip from './Tooltip.svelte';
  import { preferences, type Preferences } from '#lib/settings/preferences.svelte.ts';

  interface Props {
    key: keyof Preferences;
  }

  let { key }: Props = $props();
  const isExcluded = $derived(preferences.settingsSync && NON_SYNCABLE_KEYS.has(key));
</script>

{#snippet trigger({ props }: { props: Record<string, unknown> })}
  <button
    {...props}
    class="badge-anchor"
    type="button"
    aria-label={i18n.t('settings.settingExcludedFromSync')}
  >
    <CloudXIcon />
  </button>
{/snippet}

{#if isExcluded}
  <Tooltip class="badge-anchor" label={i18n.t('settings.settingExcludedFromSync')} {trigger} />
{/if}

<style>
  .badge-anchor {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--radius-inner);
    color: var(--surface-var-on-container);
    cursor: pointer;
    display: inline-flex;
    flex: 0 0 auto;
    height: var(--icon-size-large);
    justify-content: center;
    padding: 0;
    width: var(--icon-size-large);
  }

  .badge-anchor:hover {
    background: var(--surface-container-hover);
    color: var(--surface-on-container);
  }

  .badge-anchor:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }

  .badge-anchor :global(svg) {
    height: var(--icon-size-small);
    width: var(--icon-size-small);
  }
</style>
