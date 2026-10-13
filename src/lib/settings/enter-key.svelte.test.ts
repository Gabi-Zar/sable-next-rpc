import { afterEach, expect, test, vi } from 'vitest';

const pointer = vi.hoisted(() => ({ coarse: false }));
const CoarsePointerQuery = vi.hoisted(
  () =>
    class {
      get current() {
        return pointer.coarse;
      }
    }
);

vi.mock('svelte/reactivity', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  MediaQuery: CoarsePointerQuery,
}));

import { enterInsertsNewline } from './enter-key.svelte.js';
import { preferences } from './preferences.svelte.js';

afterEach(() => {
  preferences.enterForNewline = 'adaptive';
});

test.each([
  ['adaptive', true, true],
  ['adaptive', false, false],
  ['newline', false, true],
  ['send', true, false],
] as const)('%s with a coarse pointer=%s inserts a newline=%s', (mode, coarse, expected) => {
  pointer.coarse = coarse;
  preferences.enterForNewline = mode;
  expect(enterInsertsNewline()).toBe(expected);
});
