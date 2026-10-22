import { writeFileSync } from 'node:fs';
import { repository, server } from '../lib/forgejo.mjs';

const [version, tag, outputPath] = process.argv.slice(2);
if (!version || !tag || !outputPath) {
  console.error('Usage: obtainium-generate.mjs <version> <tag> <output-file>');
  process.exit(1);
}

const isNightly = tag.startsWith('nightly-');
const apkName = `sable-${version}-android-universal.apk`;
const apkUrl = `${server}/${repository}/releases/download/${tag}/${apkName}`;

// Releases also carry per-ABI FOSS APKs; keep Obtainium on the universal one.
const apkFilterRegEx = 'android-universal\\.apk$';

// Obtainium fills in every other setting from its own defaults on import.
const additionalSettings = {
  about: `The next Sable Matrix client${isNightly ? ' (nightly)' : ''}`,
  apkFilterRegEx,
  fallbackToOlderReleases: true,
  ...(isNightly && {
    includePrereleases: true,
    filterReleaseTitlesByRegEx: '^Nightly build ',
  }),
};

const config = {
  apps: [
    {
      id: isNightly ? 'moe.sable.next.nightly' : 'moe.sable.client',
      url: `${server}/${repository}`,
      author: 'SableClient',
      name: isNightly ? 'Sable Nightly' : 'Sable',
      installedVersion: null,
      latestVersion: version,
      apkUrls: JSON.stringify([[apkName, apkUrl]]),
      otherAssetUrls: '[]',
      preferredApkIndex: 0,
      additionalSettings: JSON.stringify(additionalSettings),
      lastUpdateCheck: null,
      pinned: false,
      categories: ['Communication'],
      releaseDate: null,
      changeLog: null,
      overrideSource: 'Codeberg',
      allowIdChange: false,
      pendingRepoRenameUrl: null,
    },
  ],
};

writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Generated ${outputPath} for ${apkName}`);
