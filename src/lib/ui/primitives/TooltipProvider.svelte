<script module lang="ts">
  import { createContext } from 'svelte';

  const [, setProvided, hasProvided] = createContext<true>();

  export function tooltipProvided(): boolean {
    return hasProvided();
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Tooltip as BitsTooltip } from 'bits-ui';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  setProvided(true);
</script>

<BitsTooltip.Provider
  delayDuration={400}
  skipDelayDuration={80}
  ignoreNonKeyboardFocus
  disableHoverableContent
>
  {@render children()}
</BitsTooltip.Provider>
