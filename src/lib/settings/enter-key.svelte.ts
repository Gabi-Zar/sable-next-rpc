import { MediaQuery } from 'svelte/reactivity';
import { preferences } from './preferences.svelte.js';

let coarsePointer: MediaQuery | undefined;

export function enterInsertsNewline(): boolean {
  const mode = preferences.enterForNewline;
  if (mode !== 'adaptive') return mode === 'newline';
  coarsePointer ??= new MediaQuery('(pointer: coarse)');
  return coarsePointer.current;
}
