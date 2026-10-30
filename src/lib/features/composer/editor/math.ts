import { InputRule } from 'prosemirror-inputrules';
import type { NodeType } from 'prosemirror-model';

export function mathInputRule(type: NodeType): InputRule {
  const pattern = /(?:^|[^\p{L}\p{N}$])\$([^$\s\uFFFC](?:[^$\n\uFFFC]*[^$\s\uFFFC])?)\$$/u;
  return new InputRule(pattern, (state, match, _start, end) => {
    const latex = match[1];
    if (latex.startsWith('[')) return null;
    const marks = state.storedMarks ?? state.selection.$from.marks();
    if (marks.some((mark) => mark.type.name === 'code')) return null;
    return state.tr.replaceWith(end - latex.length - 1, end, type.create({ latex }));
  });
}
