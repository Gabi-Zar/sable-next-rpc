<script lang="ts">
  import type { Snippet } from 'svelte';
  import { GRID_GAP_PX } from './call-layout';

  interface Props {
    alone: boolean;
    tileWidth: number;
    width: number;
    height: number;
    children: Snippet;
  }

  let { alone, tileWidth, width = $bindable(), height = $bindable(), children }: Props = $props();
</script>

<ul
  class={['grid', { alone }]}
  bind:clientWidth={width}
  bind:clientHeight={height}
  style:--tile-width="{Math.floor(tileWidth)}px"
  style:--grid-gap="{GRID_GAP_PX}px"
>
  {@render children()}
</ul>

<style>
  .grid {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: var(--grid-gap);
    list-style: none;
    margin: 0;
    padding: 0;
    place-content: center;
  }

  .grid > :global(.tile) {
    aspect-ratio: var(--tile-aspect);
    inline-size: var(--tile-width);
  }

  .grid.alone {
    align-content: center;
    flex-flow: column nowrap;
    gap: var(--space-400);
  }

  .grid.alone > :global(.tile) {
    align-self: center;
    inline-size: min(var(--tile-width), 26rem);
  }
</style>
