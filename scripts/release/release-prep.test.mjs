import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { METAINFO_FILES, fastlaneChangelogs, releaseProblems } from './release-prep.mjs';

const script = fileURLToPath(new URL('./release-prep.mjs', import.meta.url));

function write(root, path, contents) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), contents);
}

/** A tree that carries every piece of a preparation. */
function releaseTree(version) {
  const root = mkdtempSync(join(tmpdir(), 'sable-prep-'));
  write(root, 'package.json', JSON.stringify({ name: 'app', version }));
  write(root, 'CHANGELOG.md', `# Changelog\n\n## ${version} (2026-10-21)\n\n* Fix a thing.\n`);
  for (const file of fastlaneChangelogs(version)) write(root, file, '- Fix a thing.\n');
  for (const file of METAINFO_FILES) {
    write(
      root,
      file,
      `<releases>\n  <release version="${version}" date="2026-10-21" />\n</releases>\n`
    );
  }
  return root;
}

test('the fastlane changelog code is the version times ten plus the ABI', () => {
  assert.deepEqual(fastlaneChangelogs('2.1.0'), [
    'fastlane/metadata/android/en-US/changelogs/20010001.txt',
    'fastlane/metadata/android/en-US/changelogs/20010002.txt',
  ]);
});

test('a complete preparation has no problems', () => {
  const root = releaseTree('1.2.3');
  try {
    assert.deepEqual(releaseProblems('1.2.3', root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every missing piece of a preparation is reported', () => {
  const root = releaseTree('1.2.3');
  try {
    rmSync(join(root, fastlaneChangelogs('1.2.3')[0]));
    write(root, 'package.json', JSON.stringify({ name: 'app', version: '1.2.2' }));
    const problems = releaseProblems('1.2.3', root);
    assert.ok(problems.includes('package.json declares 1.2.2, not 1.2.3'));
    assert.ok(
      problems.includes('fastlane/metadata/android/en-US/changelogs/10020031.txt is missing')
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the command accepts a prepared tree and rejects an unprepared one', () => {
  const root = releaseTree('1.2.3');
  try {
    const prepared = spawnSync(process.execPath, [script, '1.2.3'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(prepared.status, 0, prepared.stderr);

    rmSync(join(root, fastlaneChangelogs('1.2.3')[1]));
    const unprepared = spawnSync(process.execPath, [script, '1.2.3'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(unprepared.status, 1);
    assert.match(unprepared.stderr, /10020032\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
