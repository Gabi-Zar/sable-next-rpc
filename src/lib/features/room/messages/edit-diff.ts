import { diffArrays, diffWordsWithSpace, type ChangeObject } from 'diff';

const CONTEXT_LINES = 1;

export type EditDiffRow =
  | { kind: 'equal' | 'removed' | 'added'; text: string }
  | { kind: 'skip'; count: number };

export type EditDiffDisplay =
  | { mode: 'inline'; parts: ChangeObject<string>[] }
  | { mode: 'lines'; rows: EditDiffRow[] };

function splitLines(text: string): string[] {
  return text.replace(/^\n+|\n+$/g, '').split('\n');
}

function collapse(lines: string[], first: boolean, last: boolean): EditDiffRow[] {
  const keepStart = first ? 0 : CONTEXT_LINES;
  const keepEnd = last ? 0 : CONTEXT_LINES;
  if (lines.length <= keepStart + keepEnd + 1) {
    return lines.map((text) => ({ kind: 'equal', text }));
  }
  return [
    ...lines.slice(0, keepStart).map((text): EditDiffRow => ({ kind: 'equal', text })),
    { kind: 'skip', count: lines.length - keepStart - keepEnd },
    ...lines.slice(lines.length - keepEnd).map((text): EditDiffRow => ({ kind: 'equal', text })),
  ];
}

export function editDiff(before: string, after: string): EditDiffDisplay {
  const inline = (): EditDiffDisplay => ({
    mode: 'inline',
    parts: diffWordsWithSpace(before, after),
  });
  if (!before.includes('\n') && !after.includes('\n')) return inline();
  const changes = diffArrays(splitLines(before), splitLines(after));
  if (!changes.some((change) => change.added || change.removed)) return inline();
  const rows = changes.flatMap((change, index): EditDiffRow[] => {
    if (change.added) return change.value.map((text) => ({ kind: 'added', text }));
    if (change.removed) return change.value.map((text) => ({ kind: 'removed', text }));
    return collapse(change.value, index === 0, index === changes.length - 1);
  });
  return { mode: 'lines', rows };
}
