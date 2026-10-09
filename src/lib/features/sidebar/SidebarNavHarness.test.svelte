<script lang="ts">
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import { provideAlertProviders } from './alerts';
  import SidebarNav from './SidebarNav.svelte';

  interface Props {
    mobile?: boolean;
  }

  let { mobile }: Props = $props();

  provideAlertProviders([]);
</script>

<TooltipProvider>
  <SidebarNav {mobile} />
</TooltipProvider>
