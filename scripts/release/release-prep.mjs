import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changelogSectionIn } from '../lib/changelog.mjs';

/** The Fastlane changelog code is the version number times ten plus the ABI. */
const ABI_CODES = { arm: 1, arm64: 2 };

export const FASTLANE_DIR = 'fastlane/metadata/android/en-US/changelogs';

export const METAINFO_FILES = [
  'packaging/flatpak/moe.sable.client.metainfo.xml',
  'packaging/flatpak/electron/moe.sable.next.electron.metainfo.xml',
];

export function fastlaneChangelogs(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  const base = major * 1_000_000 + minor * 1_000 + patch;
  return Object.values(ABI_CODES).map((abi) => join(FASTLANE_DIR, `${base * 10 + abi}.txt`));
}

/** What a release tree is missing: the version bump, the changelog section, the Android changelogs and the Flatpak entries. */
export function releaseProblems(version, root = '.') {
  const read = (path) => {
    try {
      return readFileSync(join(root, path), 'utf8');
    } catch {
      return undefined;
    }
  };
  const problems = [];

  const manifest = read('package.json');
  if (manifest === undefined) {
    problems.push('package.json is missing');
  } else {
    const declared = JSON.parse(manifest).version;
    if (declared !== version) problems.push(`package.json declares ${declared}, not ${version}`);
  }

  const changelog = read('CHANGELOG.md');
  if (changelog === undefined) problems.push('CHANGELOG.md is missing');
  else if (!changelogSectionIn(changelog, version)) {
    problems.push(`CHANGELOG.md has no "## ${version}" section`);
  }

  for (const file of fastlaneChangelogs(version)) {
    if (read(file) === undefined) problems.push(`${file} is missing`);
  }

  for (const file of METAINFO_FILES) {
    const metainfo = read(file);
    if (metainfo === undefined) problems.push(`${file} is missing`);
    else if (!metainfo.includes(`<release version="${version}"`)) {
      problems.push(`${file} has no ${version} release`);
    }
  }

  return problems;
}

if (import.meta.main) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`Usage: release-prep.mjs <version>  (got: ${version ?? '<none>'})`);
    process.exit(1);
  }

  const problems = releaseProblems(version);
  if (problems.length > 0) {
    console.error(
      `The release preparation for ${version} is incomplete:\n${problems
        .map((problem) => `- ${problem}`)
        .join('\n')}`
    );
    process.exit(1);
  }
  console.log(`The release preparation for ${version} is complete.`);
}
