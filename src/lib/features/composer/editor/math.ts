import type { MarkdownIt } from 'markdown-it';
import { InputRule } from 'prosemirror-inputrules';
import type { NodeType } from 'prosemirror-model';

const WORD = /[\p{L}\p{N}$]/u;

/** The delimiter rules of `matrix_html.rs`, so what is sent is what is rendered. */
function inlineMath(src: string, pos: number, max: number): { latex: string; raw: number } | null {
  if (src[pos] !== '$' || src[pos + 1] === '$') return null;
  if (pos > 0 && WORD.test(src[pos - 1])) return null;
  const close = src.indexOf('$', pos + 1);
  if (close < 0 || close >= max) return null;
  const inner = src.slice(pos + 1, close);
  if (inner === '' || inner.includes('\n')) return null;
  if (/^\s|\s$/.test(inner) || inner.startsWith('[')) return null;
  if (/^\d/.test(src[close + 1] ?? '')) return null;
  return { latex: inner, raw: close + 1 - pos };
}

export function mathPlugin(markdown: MarkdownIt): void {
  markdown.inline.ruler.before('text', 'math_inline', (state, silent) => {
    const math = inlineMath(state.src, state.pos, state.posMax);
    if (!math) return false;
    if (!silent) state.push('math_inline', '', 0).content = math.latex;
    state.pos += math.raw;
    return true;
  });

  markdown.block.ruler.before(
    'heading',
    'math_block',
    (state, startLine, endLine, silent) => {
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      const first = state.bMarks[startLine] + state.tShift[startLine];
      if (!state.src.startsWith('$$', first)) return false;

      let line = startLine;
      let text = state.src.slice(first + 2, state.eMarks[line]);
      for (;;) {
        const close = text.indexOf('$$');
        if (close >= 0) {
          if (text.slice(close + 2).trim() !== '') return false;
          text = text.slice(0, close);
          break;
        }
        line += 1;
        if (line >= endLine) return false;
        text += `\n${state.src.slice(state.bMarks[line], state.eMarks[line])}`;
      }
      const latex = text.trim();
      if (latex === '') return false;
      if (silent) return true;

      state.line = line + 1;
      const token = state.push('math_block', '', 0);
      token.content = latex;
      token.map = [startLine, state.line];
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote'] }
  );
}

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
