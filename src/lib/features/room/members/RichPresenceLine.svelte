<script lang="ts">
  import type { ClassValue } from 'svelte/elements';
  import GameControllerIcon from 'phosphor-svelte/lib/GameControllerIcon';
  import MusicNotesIcon from 'phosphor-svelte/lib/MusicNotesIcon';

  import { summarizePresence, type RichPresence } from '#lib/profile/rich-presence.js';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';

  interface Props {
    presences: readonly RichPresence[];
    class?: ClassValue;
  }

  let { presences, class: className = '' }: Props = $props();

  let first = $derived(presences[0] ?? null);
  let summary = $derived(first === null ? null : summarizePresence(first));
  let text = $derived(
    summary === null ? '' : [summary.title, summary.subtitle].filter(Boolean).join(' · ')
  );
</script>

{#if first && summary}
  <Tooltip label={text}>
    {#snippet trigger({ props })}
      <span {...props} class={['rich-presence-line', className]}>
        <span class="rich-presence-icon" aria-hidden="true">
          {#if first.kind === 'music'}
            <MusicNotesIcon weight="fill" />
          {:else}
            <GameControllerIcon weight="fill" />
          {/if}
        </span>
        <span class="rich-presence-text">{text}</span>
      </span>
    {/snippet}
  </Tooltip>
{/if}

<style>
  .rich-presence-line {
    align-items: center;
    display: inline-flex;
    gap: var(--space-100);
    max-width: 100%;
    min-width: 0;
    vertical-align: bottom;
  }

  .rich-presence-icon {
    display: inline-flex;
    flex: none;
  }

  .rich-presence-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
