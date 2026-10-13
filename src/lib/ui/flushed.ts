import { flushSync } from 'svelte';

// Async mode makes `tick()` wait for a frame; this keeps the old microtask + flush timing.
export async function flushed(): Promise<void> {
  await Promise.resolve();
  flushSync();
}
