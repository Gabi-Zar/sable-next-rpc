import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { changelogSection } from '../lib/changelog.mjs';
import { forgejo } from '../lib/forgejo.mjs';

function changelogEntry(version) {
  const section = changelogSection(version);
  if (!section) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  return section.body;
}

async function pullRequest() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const title = `chore: prepare release ${version}`;
  const body = `> [!IMPORTANT]\n> Merging this PR will create a new release.\n\n${changelogEntry(version)}`;
  const open = await forgejo('GET', '/pulls?state=open&base=main&limit=50');
  const existing = open.find((pull) => pull.head.ref === 'release');
  if (existing) {
    await forgejo('PATCH', `/pulls/${existing.number}`, { json: { title, body } });
    console.log(`Updated pull request #${existing.number}.`);
  } else {
    const created = await forgejo('POST', '/pulls', {
      json: { head: 'release', base: 'main', title, body },
    });
    console.log(`Created pull request #${created.number}.`);
  }
}

async function release() {
  const [shaArgument, versionArgument] = process.argv.slice(3);
  const version = versionArgument ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
  const sha =
    shaArgument ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tag = `v${version}`;
  if (await forgejo('GET', `/releases/tags/${tag}`, { allow404: true })) {
    console.log(`Release ${tag} already exists.`);
    return;
  }
  await forgejo('POST', '/releases', {
    json: {
      tag_name: tag,
      target_commitish: sha,
      name: tag,
      body: changelogEntry(version),
    },
  });
  console.log(`Created release ${tag} at ${sha}.`);
}

const commands = { pr: pullRequest, release };
const run = commands[process.argv[2]];
if (!run) {
  console.error('Usage: forgejo-release-pr.mjs <pr|release> [sha] [version]');
  process.exit(1);
}

await run();
