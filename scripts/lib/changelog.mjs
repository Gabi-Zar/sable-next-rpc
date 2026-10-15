import { readFileSync } from 'node:fs';

export function changelogSection(version) {
  const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n');
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
