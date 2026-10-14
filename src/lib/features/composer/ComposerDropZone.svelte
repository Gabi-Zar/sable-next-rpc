<script lang="ts">
  import { Portal } from 'bits-ui';
  import FileIcon from 'phosphor-svelte/lib/FileIcon';

  import { i18n } from '#lib/i18n.js';
  import { listenNativeFileDrop } from '#lib/platform/file-drop.js';
  import { REORDER_DRAG_TYPE } from '#lib/ui/drag-list.js';

  import { filesFrom } from '#lib/composer/composer-files.js';

  interface Props {
    roomName: string | null;
    readOnly: boolean;
    onFiles: (files: File[]) => Promise<void>;
  }

  let { roomName, readOnly, onFiles }: Props = $props();

  let dragging = $state(false);
  let dropTarget = $derived(roomName ?? i18n.t('timeline.thisRoom'));

  function reorderDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes(REORDER_DRAG_TYPE) ?? false;
  }

  function markInPageDrag(event: DragEvent): void {
    event.dataTransfer?.setData(REORDER_DRAG_TYPE, '');
  }

  function handleDrop(event: DragEvent): void {
    dragging = false;
    if (event.defaultPrevented || readOnly || reorderDrag(event)) return;

    const files = filesFrom(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    void onFiles(files);
  }

  function handleDragover(event: DragEvent): void {
    if (readOnly || reorderDrag(event) || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    dragging = true;
  }

  function handleDragleave(event: DragEvent): void {
    if (event.relatedTarget !== null) return;
    dragging = false;
  }

  $effect(() =>
    listenNativeFileDrop({
      onEnter: () => (dragging = !readOnly),
      onLeave: () => (dragging = false),
      onDrop: (files) => {
        if (!readOnly) void onFiles(files);
      },
    })
  );
</script>

<svelte:window
  ondragstart={markInPageDrag}
  ondragover={handleDragover}
  ondragleave={handleDragleave}
  ondrop={handleDrop}
  ondragend={() => (dragging = false)}
/>

{#if dragging}
  <Portal>
    <div class="drop-overlay" aria-hidden="true">
      <div class="drop-card">
        <FileIcon size={40} weight="light" />
        <p class="drop-title">{i18n.t('timeline.dropFiles', { room: dropTarget })}</p>
      </div>
    </div>
  </Portal>
{/if}

<style>
  .drop-overlay {
    align-items: center;
    background: var(--overlay);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: var(--space-400);
    pointer-events: none;
    position: fixed;
    z-index: var(--layer-overlay);
  }

  .drop-card {
    align-items: center;
    background: var(--bg-container);
    border: var(--border-width) dashed var(--primary-main);
    border-radius: var(--radius);
    box-shadow: var(--shadow-dialog);
    color: var(--primary-main);
    display: flex;
    flex-direction: column;
    gap: var(--space-200);
    max-width: min(28rem, 100%);
    padding: var(--space-600) var(--space-500);
    text-align: center;
  }

  .drop-title {
    font-size: var(--font-size-heading);
    font-weight: var(--font-weight-bold);
    line-height: var(--line-height-heading);
    margin: 0;
    overflow-wrap: anywhere;
  }
</style>
