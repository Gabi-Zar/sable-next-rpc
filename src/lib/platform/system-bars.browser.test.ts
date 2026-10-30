import { expect, test } from 'vitest';

import { isLightColor, opaqueArgb } from './system-bars.js';

test('system-bar contrast reads browser CSS color spaces through the canvas fallback', () => {
  expect(isLightColor('hsl(0 0% 100%)')).toBe(true);
  expect(isLightColor('oklch(0 0 0)')).toBe(false);
  expect(isLightColor('rgba(20, 40, 60, 0)')).toBe(false);
});

test('wide-gamut surfaces pack opaque sRGB and invalid colors do not reuse the last swatch', () => {
  expect(opaqueArgb('color(display-p3 1 0 0)')).toBe(0xffff0000 | 0);
  expect(opaqueArgb('hsl(120 100% 50%)')).toBe(0xff00ff00 | 0);
  expect(opaqueArgb('hsl(0 0% 50%)')).toBe(0xff808080 | 0);
  expect(opaqueArgb('unknown')).toBeUndefined();
});
