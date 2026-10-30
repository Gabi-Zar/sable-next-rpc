import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { inc, parse, valid } from 'semver';

function commitDate() {
  try {
    const seconds = execSync('git log -1 --format=%ct', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^\d+$/.test(seconds)) return new Date(Number(seconds) * 1000);
  } catch {
    // Checkouts without git history fall back to the current time.
  }
  return new Date();
}

function nightlyVersion(gitSha) {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const parsed = parse(version);
  if (!parsed || parsed.prerelease.length > 0 || parsed.build.length > 0) {
    throw new Error(`package.json version must be stable SemVer (got: ${version})`);
  }

  const date = commitDate();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    String(date.getUTCFullYear()).slice(-2),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');

  return `${inc(parsed, 'patch')}-nightly.${stamp}.g${gitSha.slice(0, 12)}`;
}

function resolveReleaseMeta({ eventName, inputTag, gitRef, gitRefName, gitSha }) {
  if (eventName === 'workflow_dispatch' && inputTag) {
    if (!valid(inputTag)) throw new Error(`Invalid release tag: ${inputTag}`);
    return { tag: inputTag, version: inputTag.replace(/^v/, ''), ref: inputTag, nightly: false };
  }
  if (gitRef === 'refs/heads/main') {
    if (!/^[0-9a-f]{12,}$/i.test(gitSha)) {
      throw new Error('GIT_SHA must contain at least 12 hexadecimal characters for nightly builds');
    }
    const version = nightlyVersion(gitSha);
    return { tag: `nightly-${version}`, version, ref: gitSha, nightly: true };
  }
  if (gitRefName.startsWith('v') && valid(gitRefName)) {
    return { tag: gitRefName, version: gitRefName.replace(/^v/, ''), ref: gitRef, nightly: false };
  }
  throw new Error(`No release target for ref ${gitRef || '<none>'}`);
}

const outputPath = process.argv[2];
if (!outputPath) {
  console.error('Usage: release-meta.mjs <output-file>');
  process.exit(1);
}

const meta = resolveReleaseMeta({
  eventName: process.env.EVENT_NAME ?? '',
  inputTag: process.env.INPUT_TAG ?? '',
  gitRef: process.env.GIT_REF ?? '',
  gitRefName: process.env.GIT_REF_NAME ?? '',
  gitSha: process.env.GIT_SHA ?? '',
});

const entries = Object.entries(meta).map(([key, value]) => `${key}=${value}`);
appendFileSync(outputPath, `${entries.join('\n')}\n`);
