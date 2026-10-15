import { expect, test } from 'vitest';

import { parseUsage, rememberSuggestion, usageOf } from './suggestion-usage';

const day = 24 * 60 * 60 * 1000;

test('a count halves every fortnight', () => {
  const now = Date.now();
  rememberSuggestion('decay:a', now);
  expect(usageOf('decay:a', now)).toBeCloseTo(1);
  expect(usageOf('decay:a', now + 14 * day)).toBeCloseTo(0.5);
});

test('recent use outweighs old use', () => {
  const now = Date.now();
  for (let index = 0; index < 4; index += 1) rememberSuggestion('decay:old', now - 90 * day);
  rememberSuggestion('decay:new', now);
  expect(usageOf('decay:new', now)).toBeGreaterThan(usageOf('decay:old', now));
});

test('the old plain-count format is still read', () => {
  expect(parseUsage({ x: 3, y: 'no' }, 10)).toEqual({ x: { score: 3, at: 10 } });
});

test('an emote keeps the usage recorded before its id carried the url', () => {
  const now = Date.now();
  rememberSuggestion('pack:wave', now);

  expect(usageOf('pack:wave mxc://example.org/wave', now)).toBeCloseTo(1);
  expect(usageOf('pack:other mxc://example.org/wave', now)).toBe(0);

  rememberSuggestion('pack:wave mxc://example.org/wave', now);
  expect(usageOf('pack:wave mxc://example.org/wave', now)).toBeCloseTo(2);
});
