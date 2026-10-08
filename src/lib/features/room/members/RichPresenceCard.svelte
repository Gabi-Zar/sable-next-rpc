<script lang="ts">
  import { opensExternalUrls, openExternalUrl } from '#lib/platform/external-links.js';
  import { i18n } from '#lib/i18n.js';
  import {
    formatClock,
    isTimed,
    openableButtons,
    presenceSpan,
    progressFraction,
    type RichPresence,
    type RichPresenceIcon,
  } from '#lib/profile/rich-presence.js';
  import MediaImage from '#lib/ui/MediaImage.svelte';
  import Button from '#lib/ui/primitives/Button.svelte';
  import ConfirmDialog from '#lib/ui/primitives/ConfirmDialog.svelte';
  import Progress from '#lib/ui/primitives/Progress.svelte';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';

  interface Props {
    presences: readonly RichPresence[];
    /** Whose activity this is, named in the confirmation shown before a link opens. */
    name: string;
  }

  let { presences, name }: Props = $props();

  let now = $state(Date.now());
  let pendingUrl = $state<string | null>(null);

  // Elapsed time, countdowns and progress bars only move when the clock does.
  $effect(() => {
    now = Date.now();
    if (!presences.some(isTimed)) return;
    const interval = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  });

  function open(url: string): void {
    if (opensExternalUrls()) {
      void openExternalUrl(url).catch((error: unknown) => {
        console.warn('[sable rich presence] external link unavailable', url, error);
      });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function clocks(presence: RichPresence): { elapsed: string | null; remaining: string | null } {
    if (presence.kind === 'music') {
      const span = presence.progress;
      return span === null
        ? { elapsed: null, remaining: null }
        : {
            elapsed: formatClock(Math.min(now, span.until) - span.since),
            remaining: formatClock(span.until - span.since),
          };
    }
    return {
      elapsed:
        presence.since !== null && presence.until === null
          ? i18n.t('richPresence.elapsed', { time: formatClock(now - presence.since) })
          : null,
      remaining:
        presence.until !== null
          ? i18n.t('richPresence.remaining', { time: formatClock(presence.until - now) })
          : null,
    };
  }
</script>

{#snippet picture(large: RichPresenceIcon | null, small: RichPresenceIcon | null)}
  {#if large}
    <span class="rich-presence-art">
      <Tooltip label={large.tooltip ?? ''} disabled={large.tooltip === null}>
        {#snippet trigger({ props })}
          <span {...props} class="rich-presence-large">
            <MediaImage
              source={large.url}
              alt=""
              width={96}
              height={96}
              class="rich-presence-img"
            />
          </span>
        {/snippet}
      </Tooltip>
      {#if small}
        <Tooltip label={small.tooltip ?? ''} disabled={small.tooltip === null}>
          {#snippet trigger({ props })}
            <span {...props} class="rich-presence-small">
              <MediaImage
                source={small.url}
                alt=""
                width={48}
                height={48}
                class="rich-presence-img"
              />
            </span>
          {/snippet}
        </Tooltip>
      {/if}
    </span>
  {/if}
{/snippet}

<div class="rich-presences" role="region" aria-label={i18n.t('richPresence.region')}>
  {#each presences as presence (presence.id)}
    {@const span = presenceSpan(presence)}
    {@const times = clocks(presence)}
    {@const buttons = openableButtons(presence)}
    <section class="rich-presence">
      <h4 class="rich-presence-heading">
        {presence.kind === 'music' ? i18n.t('richPresence.music') : i18n.t('richPresence.activity')}
      </h4>
      <div class="rich-presence-body">
        {#if presence.kind === 'music'}
          {@render picture(
            presence.coverUrl === null ? null : { url: presence.coverUrl, tooltip: presence.album },
            null
          )}
          <div class="rich-presence-text">
            <span class="rich-presence-title">{presence.track}</span>
            {#if presence.artist}<span class="rich-presence-line">{presence.artist}</span>{/if}
            {#if presence.album}<span class="rich-presence-line">{presence.album}</span>{/if}
            {#if presence.playerName}
              <span class="rich-presence-line">
                {i18n.t('richPresence.on', { player: presence.playerName })}
              </span>
            {/if}
          </div>
        {:else}
          {@render picture(presence.largeIcon, presence.smallIcon)}
          <div class="rich-presence-text">
            <span class="rich-presence-title">{presence.name}</span>
            {#if presence.state}<span class="rich-presence-line">{presence.state}</span>{/if}
            {#if presence.details}<span class="rich-presence-line">{presence.details}</span>{/if}
            {#if span === null && times.elapsed}
              <span class="rich-presence-line">{times.elapsed}</span>
            {/if}
            {#if span === null && times.remaining}
              <span class="rich-presence-line">{times.remaining}</span>
            {/if}
          </div>
        {/if}
      </div>
      {#if span}
        {@const fraction = progressFraction(span.since, span.until, now) ?? 0}
        <div class="rich-presence-progress">
          <Progress
            value={Math.round(fraction * 100)}
            label={i18n.t('richPresence.progress', {
              elapsed: formatClock(Math.min(now, span.until) - span.since),
              total: formatClock(span.until - span.since),
            })}
          />
          <span class="rich-presence-clocks" aria-hidden="true">
            <span>{formatClock(Math.min(Math.max(now, span.since), span.until) - span.since)}</span>
            <span>{formatClock(span.until - span.since)}</span>
          </span>
        </div>
      {/if}
      {#if buttons.length > 0}
        <div class="rich-presence-buttons">
          {#each buttons as button (button.label + button.url)}
            <Button
              variant="secondary"
              size="small"
              onclick={() => {
                pendingUrl = button.url;
              }}>{button.label}</Button
            >
          {/each}
        </div>
      {/if}
    </section>
  {/each}
</div>

<ConfirmDialog
  open={pendingUrl !== null}
  title={i18n.t('richPresence.openLinkTitle')}
  description={i18n.t('richPresence.openLinkDescription', { name })}
  confirmLabel={i18n.t('richPresence.openLink')}
  confirmVariant="primary"
  onOpenChange={(next: boolean) => {
    if (!next) pendingUrl = null;
  }}
  onCancel={() => {
    pendingUrl = null;
  }}
  onConfirm={() => {
    const url = pendingUrl;
    pendingUrl = null;
    if (url !== null) open(url);
  }}
>
  {#if pendingUrl !== null}
    <p class="rich-presence-url">{pendingUrl}</p>
  {/if}
</ConfirmDialog>

<style>
  .rich-presences {
    display: grid;
    gap: var(--space-300);
  }

  .rich-presence {
    display: grid;
    gap: var(--space-200);
    min-width: 0;
  }

  .rich-presence-heading {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    margin: 0;
  }

  .rich-presence-body {
    align-items: center;
    display: flex;
    gap: var(--space-300);
    min-width: 0;
  }

  .rich-presence-art {
    display: inline-flex;
    flex: none;
    position: relative;
  }

  .rich-presence-large,
  .rich-presence-small {
    display: inline-flex;
    overflow: hidden;
  }

  .rich-presence-large {
    block-size: 3.5rem;
    border-radius: var(--radius);
    inline-size: 3.5rem;
  }

  .rich-presence-small {
    background: var(--bg-container);
    block-size: 1.5rem;
    border-radius: var(--radii-pill);
    bottom: calc(-1 * var(--space-100));
    inline-size: 1.5rem;
    position: absolute;
    right: calc(-1 * var(--space-100));
  }

  :global(.rich-presence-img) {
    block-size: 100%;
    inline-size: 100%;
    object-fit: cover;
  }

  .rich-presence-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .rich-presence-title {
    overflow-wrap: anywhere;
  }

  .rich-presence-line {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
  }

  .rich-presence-progress {
    display: grid;
    gap: var(--space-100);
  }

  .rich-presence-clocks {
    color: var(--surface-var-on-container);
    display: flex;
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    justify-content: space-between;
  }

  .rich-presence-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-200);
  }

  .rich-presence-url {
    background: var(--surface-container);
    border-radius: var(--radius);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-small);
    margin: 0;
    overflow-wrap: anywhere;
    padding: var(--space-200) var(--space-300);
    user-select: all;
  }
</style>
