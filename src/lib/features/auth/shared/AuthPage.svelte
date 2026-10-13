<script lang="ts">
  import type { Snippet } from 'svelte';
  import Spinner from '#lib/ui/primitives/Spinner.svelte';
  import AuthFooter from './AuthFooter.svelte';
  import AuthHeader from './AuthHeader.svelte';

  interface Props {
    hasLoggedInBefore: boolean;
    title?: string;
    status?: string;
    children: Snippet;
  }

  let { hasLoggedInBefore, title, status, children }: Props = $props();
</script>

<main class="auth-page">
  <section class="auth-content" aria-labelledby="sable-title">
    <AuthHeader {hasLoggedInBefore} {title} />
    <div class="auth-main">
      {#if status}
        <div class="bootstrap" role="status">
          <Spinner />
          <p>{status}</p>
        </div>
      {:else}
        {@render children()}
      {/if}
    </div>
  </section>
  <AuthFooter />
</main>

<style>
  .auth-page {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: var(--space-700) var(--space-600);
    padding-block: calc(var(--space-700) + var(--safe-top))
      calc(var(--space-700) + var(--safe-bottom));
    padding-inline: max(var(--space-600), var(--safe-left)) max(var(--space-600), var(--safe-right));
  }

  .auth-content {
    display: grid;
    flex: 1 0 auto;
    grid-template-rows: calc((100dvh - 4rem) / 3) auto;
    margin: 0 auto;
    max-width: 78rem;
    width: 100%;
  }

  .auth-main {
    align-self: start;
    min-width: 0;
    padding-bottom: var(--space-800);
  }

  .bootstrap {
    align-items: center;
    display: flex;
    gap: var(--space-300);
    justify-content: center;
  }

  .bootstrap p {
    margin: 0;
  }

  @media (width <= 48rem) {
    .auth-content {
      grid-template-rows: clamp(9rem, 18dvh, 12rem) auto;
    }
  }
</style>
