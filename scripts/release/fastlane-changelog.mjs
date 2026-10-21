import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { changelogSection } from '../lib/changelog.mjs';
import { FASTLANE_DIR, fastlaneChangelogs } from './release-prep.mjs';

const LIMIT = 500;
const KINDS = new Set(['feat', 'fix', 'perf']);

const {
  values: { check, force },
  positionals: [version],
} = parseArgs({
  options: { check: { type: 'boolean' }, force: { type: 'boolean' } },
  allowPositionals: true,
});

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    `Usage: fastlane-changelog.mjs <version> [--check] [--force]  (got: ${version ?? '<none>'})`
  );
  process.exit(1);
}

const files = fastlaneChangelogs(version);
if (check) {
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    console.error(
      `Missing fastlane changelogs, run this script and commit them before tagging:\n${missing.join('\n')}`
    );
    process.exit(1);
  }
  process.exit(0);
}

const git = (...gitArgs) =>
  execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function fromChangelog() {
  return (changelogSection(version)?.body ?? '')
    .split('\n')
    .filter((line) => /^[*-] /.test(line))
    .map((line) => `- ${line.slice(2).replace(/ by @\S+( in #\d+)?\.?$/, '')}`);
}

function fromCommits() {
  let tag;
  try {
    tag = git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD');
  } catch {
    tag = undefined;
  }
  const subjects = git('log', '--no-merges', '--format=%s', tag ? `${tag}..HEAD` : 'HEAD').split(
    '\n'
  );
  const bullets = [];
  for (const subject of subjects) {
    const match = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/.exec(subject);
    if (!match || !KINDS.has(match[1])) continue;
    const text = match[3].replace(/ \(#\d+\)$/, '');
    const bullet = `- ${text[0].toUpperCase()}${text.slice(1)}`;
    if (!bullets.includes(bullet)) bullets.push(bullet);
  }
  return bullets;
}

const fromFile = fromChangelog();
const bullets = fromFile.length > 0 ? fromFile : fromCommits();

const size = (text) => Buffer.byteLength(text, 'utf8');
let changelog = '';
for (const bullet of bullets) {
  const next = changelog ? `${changelog}\n${bullet}` : bullet;
  if (size(next) > LIMIT) break;
  changelog = next;
}
if (!changelog) {
  throw new Error('No feat, fix or perf commits to summarise; write the changelog by hand.');
}

mkdirSync(FASTLANE_DIR, { recursive: true });
for (const file of files) {
  if (existsSync(file) && !force) {
    console.log(`Kept ${file}`);
    continue;
  }
  writeFileSync(file, `${changelog}\n`);
  console.log(`Wrote ${file}`);
}
