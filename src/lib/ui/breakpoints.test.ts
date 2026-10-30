import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { expect, test } from 'vitest';

import { BREAKPOINTS } from './breakpoints';

test('CSS and JavaScript use the same layout breakpoints', () => {
  const definitions = new Map<string, string>();
  postcss
    .parse(readFileSync(new URL('./media.css', import.meta.url), 'utf8'))
    .walkAtRules('custom-media', ({ params }) => {
      const [, name, query] = params.match(/^(--[\w-]+)\s+(.+)$/) ?? [];
      if (name && query) definitions.set(name, query);
    });

  expect(definitions.get('--compact-height')).toBe(BREAKPOINTS.compactHeight);
  expect(definitions.get('--app-layout')).toBe(`${BREAKPOINTS.wide} and (not (--compact-height))`);
  expect(definitions.get('--compact-layout')).toBe('not (--app-layout)');
});
