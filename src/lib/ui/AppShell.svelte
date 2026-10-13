<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity';
  import type { Snippet } from 'svelte';
  import MobileNavDrawer from '#lib/ui/MobileNavDrawer.svelte';
  import SidebarNav from '#lib/features/sidebar/SidebarNav.svelte';
  import DeviceVerificationDialog from '#lib/features/settings/DeviceVerificationDialog.svelte';
  import { BREAKPOINTS } from './breakpoints';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
  let roomNavWidth = $state(288);
  const appLayout = new MediaQuery(BREAKPOINTS.appLayout);
</script>

<div class="app-shell" style:--room-nav-width={String(roomNavWidth) + 'px'}>
  {#if appLayout.current}
    <div class="desktop-navigation">
      <SidebarNav bind:roomNavWidth />
    </div>
  {/if}
  <MobileNavDrawer>
    {@render children()}
  </MobileNavDrawer>
</div>

<DeviceVerificationDialog />

<style>
  .app-shell {
    height: 100%;
  }

  .desktop-navigation {
    display: none;
  }

  @media (width >= 48rem) {
    .desktop-navigation {
      display: contents;
    }
  }
</style>
