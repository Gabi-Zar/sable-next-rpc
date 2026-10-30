// Usage: render-flatpak-nightly.mjs <version> <tag> <x86_64-sha256:size> <aarch64-sha256:size> [date]
// Pass "-" for an architecture that is not being published.

import { readFileSync, writeFileSync } from 'node:fs';
import { flatpakTarget, parseArches, renderSources } from '../lib/flatpak.mjs';

const { dir, id } = flatpakTarget('nightly');
const [version, tag, x86, arm, dateArg] = process.argv.slice(2);

if (!version || !tag || !x86 || !arm) {
  console.error(
    'Usage: render-flatpak-nightly.mjs <version> <tag> <x86_64-sha256:size> <aarch64-sha256:size> [date]'
  );
  process.exit(1);
}

const arches = parseArches(x86, arm, { sized: true });

const date = dateArg || new Date().toISOString().slice(0, 10);

const manifest = renderSources(
  readFileSync(`${dir}/${id}.yml.in`, 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@TAG@', tag),
  arches,
  'extra-data'
);

writeFileSync(`${dir}/${id}.yml`, manifest);
writeFileSync(
  `${dir}/${id}.metainfo.xml`,
  readFileSync(`${dir}/${id}.metainfo.xml.in`, 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@DATE@', date)
);

console.log(`Rendered the nightly Flatpak manifest for ${version} (${date})`);
