<script lang="ts">
  import { i18n } from '#lib/i18n.js';

  interface Props {
    label: string;
    max?: number;
    value?: number;
    count?: string | null;
    onCancel?: () => void;
  }

  let { label, max, value, count = null, onCancel }: Props = $props();
</script>

<div class="transfer">
  {#if value === undefined}
    <progress class="upload" aria-label={label}></progress>
  {:else}
    <progress class="upload" {max} {value} aria-label={label}></progress>
  {/if}
  {#if count !== null}
    <span class="transfer-count">
      {count}
    </span>
  {/if}
  {#if onCancel}
    <button type="button" class="transfer-cancel" onclick={onCancel}>
      {i18n.t('common.cancel')}
    </button>
  {/if}
</div>

<style>
  .transfer {
    align-items: center;
    display: flex;
    gap: var(--space-100);
    margin-top: var(--space-100);
  }

  .upload {
    accent-color: var(--primary-main);
    display: block;
    flex: 0 1 16rem;
    height: 0.25rem;
    min-width: 0;
  }

  .transfer-count {
    color: var(--surface-var-on-container);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .transfer-cancel {
    background: none;
    border: 0;
    color: var(--surface-var-on-container);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    padding: 0;
    position: relative;
    text-decoration: underline;
    text-underline-offset: 0.15em;
  }

  .transfer-cancel::after {
    content: '';
    inset: -0.5rem -0.25rem;
    position: absolute;
  }

  .transfer-cancel:focus-visible {
    border-radius: var(--radii-200);
    outline: var(--focus-ring-width) solid var(--focus-ring);
    outline-offset: 0.15rem;
  }
</style>
