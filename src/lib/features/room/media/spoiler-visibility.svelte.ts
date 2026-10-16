import { SvelteMap } from 'svelte/reactivity';

export const spoilerVisibility = new SvelteMap<string, boolean>();

export function spoilerVisibilityKey(
  eventId: string | undefined,
  source: string | null | undefined,
  spoiler: string | null
): string {
  return JSON.stringify([eventId, source, spoiler]);
}
