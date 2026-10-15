import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';

import { parseMatrixHtml } from './editor/schema';
import { serializeComposer, type ComposerMessage } from './editor/serialize';

export interface SedEdit {
  find: string;
  replacement: string;
}

const SED = /^s\/((?:[^/\\\n]|\\.)+)\/((?:[^/\\\n]|\\.)*)\/?$/;

function unescapeSlash(part: string): string {
  return part.replaceAll('\\/', '/');
}

/** `s/find/replace`: plain text, first match only. */
export function parseSed(text: string): SedEdit | null {
  const match = SED.exec(text.trim());
  if (!match) return null;
  return { find: unescapeSlash(match[1]), replacement: unescapeSlash(match[2]) };
}

/** The body after the edit, or `null` when `find` is not in it. */
export function applySed(body: string, { find, replacement }: SedEdit): string | null {
  const at = body.indexOf(find);
  if (at === -1) return null;
  return body.slice(0, at) + replacement + body.slice(at + find.length);
}

function findInText(doc: ProseMirrorNode, find: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.descendants((block, blockPos) => {
    if (found) return false;
    if (!block.isTextblock) return true;
    let run = '';
    let start = 0;
    const search = () => {
      const at = run.indexOf(find);
      if (at !== -1) found ??= { from: start + at, to: start + at + find.length };
      run = '';
    };
    block.forEach((child, offset) => {
      if (!child.isText) {
        search();
        return;
      }
      if (run === '') start = blockPos + 1 + offset;
      run += child.text ?? '';
    });
    search();
    return false;
  });
  return found;
}

export function applySedToHtml(
  html: string,
  { find, replacement }: SedEdit
): ComposerMessage | null {
  const doc = parseMatrixHtml(html);
  const range = findInText(doc, find);
  if (!range) return null;
  const transform = new Transform(doc);
  if (replacement === '') transform.delete(range.from, range.to);
  else {
    const marks = doc.nodeAt(range.from)?.marks;
    transform.replaceWith(range.from, range.to, doc.type.schema.text(replacement, marks));
  }
  return serializeComposer(transform.doc);
}
