import { expect, test } from 'vitest';

import { applySed, parseSed } from './sed-edit';

const sed = (text: string) => {
  const parsed = parseSed(text);
  if (!parsed) throw new Error(`${text} is not a sed edit`);
  return parsed;
};

test('replaces the first match only', () => {
  expect(applySed('one fish two fish', sed('s/fish/cat'))).toBe('one cat two fish');
  expect(applySed('one fish two fish', sed('s/fish/cat/'))).toBe('one cat two fish');
});

test('matches plain text, case and all', () => {
  expect(applySed('One FISH', sed('s/fish/cat'))).toBeNull();
  expect(applySed('1+1=2', sed('s/1+1/2*1'))).toBe('2*1=2');
});

test('the replacement is literal, so dollar patterns are kept', () => {
  expect(applySed('cost', sed('s/cost/$& $1'))).toBe('$& $1');
});

test('an empty replacement deletes the match', () => {
  expect(applySed('a typo here', sed('s/typo //'))).toBe('a here');
});

test('an escaped slash belongs to the find text or the replacement', () => {
  expect(applySed('a/b', sed('s/a\\/b/c\\/d'))).toBe('c/d');
});

test('reports a message that does not contain the find text', () => {
  expect(applySed('one fish', sed('s/dog/cat'))).toBeNull();
});

test('stays out of the way of anything that is not a sed edit', () => {
  for (const text of ['hello', 's/only', 's//x', 's/a/b/g', 'see s/a/b', '/s/a/b', 's/a/b\nc']) {
    expect(parseSed(text), text).toBeNull();
  }
});
