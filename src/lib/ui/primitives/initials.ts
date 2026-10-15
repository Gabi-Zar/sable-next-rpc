import { graphemes } from '#lib/graphemes.js';

const SIGIL = /^[!#@]/;

export function toInitials(name: string | null | undefined, count = 1): string {
  const trimmed = name?.replace(SIGIL, '').trim();
  if (!trimmed) return '?';

  let result = '';
  for (const { segment } of graphemes.segment(trimmed)) {
    result += segment;
    if (--count === 0) break;
  }

  return result.toLocaleUpperCase();
}
