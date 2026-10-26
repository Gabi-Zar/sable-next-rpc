import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

import { BREAKPOINTS } from '../../src/lib/ui/breakpoints.ts';

const definitions = new Map();
postcss
  .parse(readFileSync(new URL('../../src/lib/ui/media.css', import.meta.url), 'utf8'))
  .walkAtRules('custom-media', ({ params }) => {
    const [, name, query] = params.match(/^(--[\w-]+)\s+(.+)$/);
    definitions.set(name, query);
  });

assert.equal(
  definitions.get('--compact-height'),
  BREAKPOINTS.compactHeight,
  'Compact height CSS and JS differ'
);
assert.equal(
  definitions.get('--app-layout'),
  `${BREAKPOINTS.wide} and (not (--compact-height))`,
  'App layout CSS and JS differ'
);
assert.equal(definitions.get('--compact-layout'), 'not (--app-layout)');
console.log('Layout media queries match the JavaScript breakpoints.');
