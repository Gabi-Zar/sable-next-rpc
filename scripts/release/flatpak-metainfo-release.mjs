import { readFileSync, writeFileSync } from 'node:fs';
import { changelogSection } from '../lib/changelog.mjs';
import { repository, server } from '../lib/forgejo.mjs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    `Usage: node scripts/release/flatpak-metainfo-release.mjs <version>  (got: ${version ?? '<none>'})`
  );
  process.exit(1);
}

const date = changelogSection(version)?.date;
if (!date) throw new Error(`No "## ${version} (YYYY-MM-DD)" section in CHANGELOG.md`);

const paths = [
  'packaging/flatpak/moe.sable.client.metainfo.xml',
  'packaging/flatpak/electron/moe.sable.next.electron.metainfo.xml',
];

for (const path of paths) {
  const metainfo = readFileSync(path, 'utf8');
  if (metainfo.includes(`<release version="${version}"`)) {
    console.log(`${path} already lists ${version}`);
    continue;
  }

  const anchor = '  <releases>\n';
  if (!metainfo.includes(anchor)) throw new Error(`${path} has no <releases> element`);
  const entry = `    <release version="${version}" date="${date}">
      <url type="details">${server}/${repository}/releases/tag/v${version}</url>
    </release>
`;
  writeFileSync(path, metainfo.replace(anchor, `${anchor}${entry}`));
  console.log(`Added ${version} to ${path}`);
}
