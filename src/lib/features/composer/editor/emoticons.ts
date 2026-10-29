import escapeStringRegexp from 'escape-string-regexp';
import { InputRule } from 'prosemirror-inputrules';
import { emoticonEntries } from 'virtual:sable-emoji-data';

import { composerSchema } from './schema';

const emoticons = new Map(emoticonEntries);

const pattern = new RegExp(
  `(?<![^\\s\\uFFFC])(${[...emoticons.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeStringRegexp)
    .join('|')})(\\s?)$`,
  'u'
);

function insideMarkdownCode(text: string): boolean {
  let fence = '';
  let ticks = '';
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) {
        fence = '';
      }
      continue;
    }
    if (marker) {
      fence = marker;
      ticks = '';
      continue;
    }
    for (const match of line.matchAll(/\\.|(`+)/g)) {
      if (!match[1]) continue;
      if (!ticks) ticks = match[1];
      else if (ticks === match[1]) ticks = '';
    }
  }
  return fence !== '' || ticks !== '';
}

export function emoticonInputRule(enabled: () => boolean, markdown: () => boolean): InputRule {
  return new InputRule(
    pattern,
    (state, match, start, end) => {
      if (!enabled()) return null;
      // Wait for a space after letter endings so :p does not consume :party:.
      const needsSpace = /[a-z]$/i.test(match[1]);
      const hasSpace = match[2] !== '';
      if (needsSpace !== hasSpace) return null;
      const { $from } = state.selection;
      const marks = state.storedMarks ?? $from.marks();
      if (
        marks.some(
          (mark) =>
            mark.type === composerSchema.marks.code || mark.type === composerSchema.marks.link
        )
      ) {
        return null;
      }
      if (markdown() && insideMarkdownCode(state.doc.textBetween(0, start, '\n', '\n'))) {
        return null;
      }
      const emoji = emoticons.get(match[1]);
      return emoji ? state.tr.insertText(emoji + match[2], start, end) : null;
    },
    { inCodeMark: false }
  );
}
