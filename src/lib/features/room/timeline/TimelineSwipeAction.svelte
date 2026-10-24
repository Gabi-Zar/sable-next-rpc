<script lang="ts">
  import ReplyIcon from 'phosphor-svelte/lib/ArrowBendUpRightIcon';
  import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';

  interface Props {
    offset: number;
    armed: boolean;
    edit?: boolean;
  }

  let { offset, armed, edit = false }: Props = $props();
</script>

<div
  class={['swipe-action', { armed }]}
  aria-hidden="true"
  style:width={`${String(offset)}px`}
  style:transform={`translateX(${String(offset)}px)`}
>
  {#if edit}
    <PencilSimpleIcon weight="bold" />
  {:else}
    <ReplyIcon weight="bold" />
  {/if}
</div>

<style>
  .swipe-action {
    align-items: center;
    bottom: 0;
    color: var(--sec-main);
    display: flex;
    justify-content: center;
    overflow: hidden;
    pointer-events: none;
    position: absolute;
    right: 0;
    top: 0;
  }

  .swipe-action.armed {
    color: var(--primary-main);
  }
</style>
