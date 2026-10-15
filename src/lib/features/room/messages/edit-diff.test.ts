import { expect, test } from 'vitest';

import { editDiff } from './edit-diff';

test('a single-line edit is diffed word by word', () => {
  const display = editDiff('omg mea is here', 'omg mae is here');
  expect(display.mode).toBe('inline');
  if (display.mode !== 'inline') return;
  expect(display.parts.filter((part) => part.removed).map((part) => part.value)).toEqual(['mea']);
  expect(display.parts.filter((part) => part.added).map((part) => part.value)).toEqual(['mae']);
});

test('unchanged lines away from a multi-line edit collapse to one line of context', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
  const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n');
  expect(editDiff(before, after)).toEqual({
    mode: 'lines',
    rows: [
      { kind: 'skip', count: 2 },
      { kind: 'equal', text: 'c' },
      { kind: 'removed', text: 'd' },
      { kind: 'added', text: 'D' },
      { kind: 'equal', text: 'e' },
      { kind: 'skip', count: 3 },
    ],
  });
});

test('a single unchanged line is shown rather than collapsed', () => {
  expect(editDiff('a\nb\nc', 'a\nb\nC')).toEqual({
    mode: 'lines',
    rows: [
      { kind: 'equal', text: 'a' },
      { kind: 'equal', text: 'b' },
      { kind: 'removed', text: 'c' },
      { kind: 'added', text: 'C' },
    ],
  });
});

test('unchanged lines between two edits keep context on both sides', () => {
  const before = ['x', '1', '2', '3', '4', 'y'].join('\n');
  const after = ['X', '1', '2', '3', '4', 'Y'].join('\n');
  const display = editDiff(before, after);
  expect(display.mode === 'lines' && display.rows.slice(2, 5)).toEqual([
    { kind: 'equal', text: '1' },
    { kind: 'skip', count: 2 },
    { kind: 'equal', text: '4' },
  ]);
});

test('an edit that only adds trailing blank lines is diffed inline', () => {
  const display = editDiff('a\nb\nc\n', 'a\nb\nc\n\n\n');
  expect(display.mode).toBe('inline');
  if (display.mode !== 'inline') return;
  expect(display.parts.some((part) => part.added)).toBe(true);
});
