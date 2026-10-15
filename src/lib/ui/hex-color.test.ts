import { expect, test } from 'vitest';

import { hexColorOrEmpty, isHexColor } from './hex-color';

test('only three or six digit hex colours are valid', () => {
  expect(isHexColor('#abc')).toBe(true);
  expect(isHexColor('#A1B2C3')).toBe(true);
  expect(isHexColor('#abcd')).toBe(false);
  expect(isHexColor('abc')).toBe(false);
  expect(isHexColor(3)).toBe(false);
});

test('a half-typed colour is written as no colour', () => {
  expect(hexColorOrEmpty(' #abc ')).toBe('#abc');
  expect(hexColorOrEmpty('#ab')).toBe('');
});
