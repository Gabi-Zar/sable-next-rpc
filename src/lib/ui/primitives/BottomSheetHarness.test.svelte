<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';

  let { fullHeight = false }: { fullHeight?: boolean } = $props();
</script>

<BottomSheet open label="Options" closeLabel="Close" {fullHeight}>
  <div>
    <input aria-label="Filter" />
    {#each Array.from({ length: 12 }, (_, index) => index) as index (index)}
      <p><button type="button">Option {index + 1}</button></p>
    {/each}
  </div>
</BottomSheet>
