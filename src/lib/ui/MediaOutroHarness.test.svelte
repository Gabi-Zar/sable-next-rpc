<script lang="ts">
  import { fade } from 'svelte/transition';

  import MediaImage from './MediaImage.svelte';
  import Avatar from './primitives/Avatar.svelte';

  let { name, shown, avatar }: { name: string; shown: boolean; avatar: boolean } = $props();
</script>

{#if shown}
  <div out:fade|global={{ duration: 60_000 }}>
    {#if avatar}
      <Avatar src={`mxc://example.org/${name}`} name="Alice" id="@alice:example.org" />
    {:else}
      <MediaImage source={`mxc://example.org/${name}`} alt="" width={32} height={32} />
    {/if}
  </div>
{/if}
