<script lang="ts">
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUpIcon';
  import SpeakerHighIcon from 'phosphor-svelte/lib/SpeakerHighIcon';

  import ActionMenu from '#lib/ui/primitives/ActionMenu.svelte';
  import ActionMenuItem from '#lib/ui/primitives/ActionMenuItem.svelte';
  import IconButton from '#lib/ui/primitives/IconButton.svelte';

  import type { CallAudioRoute } from './call-transport';

  interface Props {
    label: string;
    list: () => Promise<CallAudioRoute[]>;
    onSelect: (routeId: string) => void;
    open?: boolean;
    icon?: 'caret' | 'speaker';
  }

  let { label, list, onSelect, open = $bindable(false), icon = 'caret' }: Props = $props();

  let routes = $state.raw<CallAudioRoute[]>([]);

  async function load(): Promise<void> {
    try {
      routes = await list();
    } catch (error) {
      console.warn('[sable call] could not list audio routes', error);
      routes = [];
    }
  }

  $effect(() => {
    if (open) void load();
  });
</script>

<ActionMenu bind:open {label} side="top" align="center">
  {#snippet trigger({ props })}
    <IconButton
      {...props}
      variant="ghost"
      size={icon === 'speaker' ? 'medium' : 'small'}
      class={icon === 'caret' ? 'device-caret' : undefined}
      {label}
    >
      {#if icon === 'speaker'}
        <SpeakerHighIcon />
      {:else}
        <CaretUpIcon weight="bold" />
      {/if}
    </IconButton>
  {/snippet}
  {#each routes as route (route.id)}
    <ActionMenuItem checked={route.current} onSelect={() => onSelect(route.id)}>
      {route.name}
    </ActionMenuItem>
  {/each}
</ActionMenu>
