<script lang="ts">
  import type { ClassValue } from 'svelte/elements';

  import { badgeFor, type SupporterBadgeData } from './award.js';
  import { supporterConfig } from './config.js';
  import SupporterBadge from './SupporterBadge.svelte';
  import type { SupporterAppearance } from './variants.js';

  type Props = Partial<SupporterAppearance> & {
    userId: string;
    awards: string | null;
    name?: string;
    isOwnBadge?: boolean;
    class?: ClassValue;
  };

  let { userId, awards, name, ...appearance }: Props = $props();
  let badge = $state.raw<SupporterBadgeData | null>(null);

  async function loadBadge(raw: string | null, id: string): Promise<SupporterBadgeData | null> {
    try {
      const config = await supporterConfig();
      return config ? await badgeFor(raw, id, config.keys) : null;
    } catch (error) {
      console.warn('[sable supporter] badge not verified', error);
      return null;
    }
  }

  $effect(() => {
    let current = true;
    void loadBadge(awards, userId).then((next) => {
      if (current) badge = next;
    });
    return () => {
      current = false;
    };
  });
</script>

{#if badge}
  <SupporterBadge
    label={badge.label}
    name={name?.trim() || userId.split(':', 1)[0]}
    {...appearance}
  />
{/if}
