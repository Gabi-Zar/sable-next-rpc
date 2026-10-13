<script lang="ts">
  import { page } from '$app/state';
  import { homeserverFromAuthUrl } from '#lib/features/auth/flow/auth-url.js';
  import { homeservers } from '#lib/features/auth/shared/homeservers.svelte.js';
  import ResetPasswordPage from '#lib/features/auth/reset-password/ResetPasswordPage.svelte';

  let homeserver = $derived(homeserverFromAuthUrl(page.url, page.route.id) ?? homeservers.default);
</script>

<ResetPasswordPage {homeserver} />
