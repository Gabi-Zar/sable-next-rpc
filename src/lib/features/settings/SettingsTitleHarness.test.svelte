<script lang="ts">
  import { Dialog } from 'bits-ui';
  import SettingsShell from './SettingsShell.svelte';
  import AppPageShell from '#lib/ui/primitives/AppPageShell.svelte';

  let { title }: { title: string } = $props();
</script>

<Dialog.Root open>
  <SettingsShell
    section={title}
    fallback={() => 'Account'}
    label="Settings"
    description="Settings"
    closeLabel="Close"
    backLabel="Back"
    sectionLabel={(section) => section}
    onBack={() => {}}
    onClose={() => {}}
  >
    {#snippet heading()}Settings{/snippet}
    {#snippet nav()}{/snippet}
    {#snippet content(section)}<AppPageShell title={section} />{/snippet}
  </SettingsShell>
</Dialog.Root>
