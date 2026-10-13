<script lang="ts">
  import { untrack } from 'svelte';
  import TooltipProvider from '#lib/ui/primitives/TooltipProvider.svelte';
  import { provideAlertProviders, type PriorityProvider } from './alerts';
  import UserQuickTools from './UserQuickTools.svelte';

  interface Props {
    mobile?: boolean;
    compact?: boolean;
    alertProviders?: PriorityProvider[];
  }

  let { mobile, compact, alertProviders = [] }: Props = $props();

  provideAlertProviders(untrack(() => alertProviders));
</script>

<TooltipProvider>
  <UserQuickTools {mobile} {compact} />
</TooltipProvider>
