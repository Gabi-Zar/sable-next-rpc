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
  <div class="auth-content">
    <AuthHeader {hasLoggedInBefore} {title} />
    <div class="auth-main">
      <div class="bootstrap" role="status" aria-atomic="true">
        {#if status}
          <Spinner />
          <p>{status}</p>
        {/if}
      </div>
      {#if !status}{@render children()}{/if}
    </div>
  </div>
  <AuthFooter />
</main>

<style>
  .auth-page {
    display: flex;
    flex-direction: column;
    height: 100%;

    /* The iOS edge-to-edge plugin pins the document scroll offset at zero. */
    overflow-y: auto;
    padding: var(--space-700) var(--space-600);
    padding-block: calc(var(--space-700) + var(--safe-top))
      calc(var(--space-700) + var(--safe-bottom));
    padding-inline: calc(var(--space-600) + var(--safe-left))
      calc(var(--space-600) + var(--safe-right));
  }

  .auth-page :global(.mobile-nav) {
    inset: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
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
