import { readFileSync } from 'node:fs';
import { changelogSection } from '../lib/changelog.mjs';
import { forgejo } from '../lib/forgejo.mjs';

async function pullRequest() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const section = changelogSection(version);
  if (!section) throw new Error(`CHANGELOG.md has no entry for ${version}`);
  const title = `chore: prepare release ${version}`;
  const body = `> [!IMPORTANT]\n> Merging this PR will create a new release.\n\n${section.body}`;
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

const commands = { pr: pullRequest };
const run = commands[process.argv[2]];
if (!run) {
  console.error('Usage: forgejo-release-pr.mjs <pr>');
  process.exit(1);
}

await run();
