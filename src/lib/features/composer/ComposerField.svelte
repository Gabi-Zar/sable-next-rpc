<script lang="ts">
  import { mergeProps } from 'bits-ui';
  import ArrowsInSimpleIcon from 'phosphor-svelte/lib/ArrowsInSimpleIcon';
  import ArrowsOutSimpleIcon from 'phosphor-svelte/lib/ArrowsOutSimpleIcon';

  import { i18n } from '#lib/i18n.js';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';
  import Tooltip from '#lib/ui/primitives/Tooltip.svelte';

  import ComposerEditorView from './editor/ComposerEditor.svelte';
  import type { ComposerEditor } from './editor/composer-editor';

  interface Props {
    editor: ComposerEditor;
    showPlaceholder: boolean;
    placeholder: string;
    expanded: boolean;
  }

  let { editor, showPlaceholder, placeholder, expanded = $bindable() }: Props = $props();
</script>

<div class="composer-field">
  <ComposerEditorView {editor} {showPlaceholder} {placeholder} {expanded} />
  <Tooltip label={i18n.t(expanded ? 'composer.collapse' : 'composer.expand')}>
    {#snippet trigger({ props })}
      <IconButton
        {...mergeProps(props, {
          onclick: () => {
            expanded = !expanded;
            editor.focus();
          },
        })}
        variant="ghost"
        size="small"
        class="composer-expand"
        aria-pressed={expanded}
        label={i18n.t('composer.expand')}
      >
        {#if expanded}<ArrowsInSimpleIcon />{:else}<ArrowsOutSimpleIcon />{/if}
      </IconButton>
    {/snippet}
  </Tooltip>
</div>

<style>
  .composer-field :global(.icon-button-small.composer-expand) {
    --button-height: var(--size-x500);
    --button-icon-size: var(--size-x50);

    color: var(--sec-main);
    inset-block-start: var(--space-050);
    inset-inline-end: var(--space-050);
    position: absolute;
  }

  .composer-field :global(.composer-expand)::after {
    content: '';
    inset: calc((var(--size-x500) - var(--target-hit)) / 2);
    position: absolute;
  }
</style>
