<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { defaultSettingsSection } from '#lib/features/settings/settings-navigation.js';
  import { AppLayout } from '#lib/ui/app-layout.svelte.js';

  const appLayout = new AppLayout();

  // Phones stay on the section list.
  $effect(() => {
    if (!appLayout.current) return;
    void goto(resolve(`settings/${defaultSettingsSection()}`), { replace: true });
  });
</script>
