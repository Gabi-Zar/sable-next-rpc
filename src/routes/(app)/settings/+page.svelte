<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { defaultSettingsSection } from '#lib/features/settings/settings-navigation.js';
  import { BREAKPOINTS } from '#lib/ui/breakpoints.js';

  const appLayout = new MediaQuery(BREAKPOINTS.appLayout);

  // Phones stay on the section list.
  $effect(() => {
    if (!appLayout.current) return;
    void goto(resolve(`settings/${defaultSettingsSection()}`), { replace: true });
  });
</script>
