import { expect, test } from 'vitest';

import { MAX_STATUS_TEXT_BYTES, statusContent, truncateUtf8 } from './fields';

test('truncation counts UTF-8 bytes and never splits a grapheme', () => {
  expect(truncateUtf8('abc', 2)).toBe('ab');
  expect(truncateUtf8('日本語', 7)).toBe('日本');
  expect(truncateUtf8('🏳️‍🌈x', 13)).toBe('');
  expect(truncateUtf8('🏳️‍🌈x', 14)).toBe('🏳️‍🌈');
});

test('status content keeps to the MSC4426 byte limits', () => {
  const status = statusContent('語'.repeat(100), '🌴'.repeat(10));

  expect(new TextEncoder().encode(status?.text).length).toBe(255);
  expect(status?.text).toHaveLength(85);
  expect(status?.emoji).toBe('🌴'.repeat(8));
  expect(statusContent('a'.repeat(MAX_STATUS_TEXT_BYTES + 1), null)?.text).toHaveLength(256);
  expect(statusContent('', '🌴')).toBeNull();
});
