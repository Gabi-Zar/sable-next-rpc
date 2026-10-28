<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { i18n } from '#lib/i18n.js';
  import Button from '#lib/ui/primitives/Button.svelte';
  import { signOutServer } from '#lib/platform/server-session.js';
  import { runtimeConfig } from '#lib/config/runtime-config.js';
  import { useCoreClient } from '#lib/core/context.js';
  import AuthFlow from '#lib/features/auth/flow/AuthFlow.svelte';
  import { takeAfterLogin } from '#lib/auth/after-login.js';
  import { followExternalLink } from '#lib/platform/external-links.js';

  let { children }: { children: Snippet } = $props();
  const core = useCoreClient();
  const loginPath = resolve('login');
  const registerPath = resolve('register');
  const setupPath = resolve('setup');
  let authEntry = $derived(
    page.url.pathname.startsWith(loginPath) ||
      page.url.pathname.startsWith(registerPath) ||
      page.url.pathname.startsWith(setupPath)
  );
  let serverSignOutFailed = $state(false);
  let accountSwitching = $state(true);
  let addingAccount = $derived(
    page.url.searchParams.has('addAccount') &&
      (accountSwitching || page.url.searchParams.has('reauth'))
  );

  onMount(() => {
    void runtimeConfig().then((config) => {
      accountSwitching = !config.disableAccountSwitcher;
    });
  });

  const onClick = (event: MouseEvent): void => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null;
    if (anchor) followExternalLink(event, anchor);
  };

  $effect(() => {
    if (core.status !== 'ready' || addingAccount) return;
    if (!authEntry || page.url.searchParams.has('addAccount')) {
      // eslint-disable-next-line svelte/no-navigation-without-resolve -- takeAfterLogin() returns a resolved path
      void goto(takeAfterLogin(resolve('/(app)/rooms')), { replace: true });
    }
  });
</script>

<svelte:document onclick={onClick} onauxclick={onClick} />

{#if authEntry}
  <AuthFlow />
  {#if import.meta.env.VITE_SABLE_SERVER_URL && !core.session}
    <div class="server-sign-out">
      <Button
        variant="secondary"
        onclick={() =>
          void signOutServer().catch(() => {
            serverSignOutFailed = true;
          })}
      >
        {i18n.t('settings.logoutServer')}
      </Button>
      {#if serverSignOutFailed}<p role="alert">{i18n.t('settings.logoutServerFailed')}</p>{/if}
    </div>
  {/if}
{/if}
{@render children()}

<style>
  .server-sign-out {
    display: grid;
    gap: var(--space-200);
    justify-items: center;
    margin: var(--space-400);
  }
</style>
