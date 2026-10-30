<script lang="ts">
  import type { PackImageView } from '#src/generated/protocol';

  import { i18n } from '#lib/i18n.js';
  import { AppLayout } from '#lib/ui/app-layout.svelte.js';
  import type { CursorAnchor } from '#lib/ui/cursor-anchor.js';
  import BottomSheet from '#lib/ui/primitives/BottomSheet.svelte';
  import EmoteBoard from '#lib/ui/primitives/EmoteBoard.svelte';

  import ReactionPicker from './ReactionPicker.svelte';

  interface Props {
    open?: boolean;
    roomId: string;
    anchor?: HTMLElement | CursorAnchor | null;
    onPick: (key: string, sourcePack?: PackImageView['source_pack']) => void;
  }

  let { open = $bindable(false), roomId, anchor = null, onPick }: Props = $props();

  const appLayout = new AppLayout();
  let sheet = $derived(!appLayout.current);

  function pick(
    key: string,
    sourcePack: PackImageView['source_pack'] = null,
    keepOpen = false
  ): void {
    if (!keepOpen) open = false;
    onPick(key, sourcePack);
  }
</script>

{#if sheet}
  <BottomSheet
    bind:open
    label={i18n.t('timeline.addReaction')}
    closeLabel={i18n.t('timeline.closeMenu')}
  >
    <EmoteBoard
      {roomId}
      variant="sheet"
      unicode
      stickers={false}
      reactions
      onPick={(image: PackImageView, _usage, keepOpen) => {
        pick(image.url, image.source_pack, keepOpen);
      }}
      onPickUnicode={(emoji, keepOpen) => {
        pick(emoji, null, keepOpen);
      }}
    />
  </BottomSheet>
{:else}
  <ReactionPicker
    bind:open
    label={i18n.t('timeline.addReaction')}
    {roomId}
    {anchor}
    onPick={pick}
  />
{/if}
