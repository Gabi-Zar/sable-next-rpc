import { readFileSync } from 'node:fs';

/** The section of a changelog that covers one release. */
export function changelogSectionIn(text, version) {
  const lines = text.split('\n');
  const heading = `## ${version} `;
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return {
    date: /^\((\d{4}-\d{2}-\d{2})\)/.exec(lines[start].slice(heading.length))?.[1],
    body: lines
      .slice(start + 1, end === -1 ? undefined : end)
      .join('\n')
      .trim(),
  };
}

export function changelogSection(version) {
  return changelogSectionIn(readFileSync('CHANGELOG.md', 'utf8'), version);
}
