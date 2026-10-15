// Usage: render-flatpak-nightly.mjs <version> <tag> <x86_64-sha256:size> <aarch64-sha256:size> [date]
// Pass "-" for an architecture that is not being published.

import { readFileSync, writeFileSync } from 'node:fs';
import { assertSubstituted, parseArches } from '../lib/flatpak.mjs';

const [version, tag, x86, arm, dateArg] = process.argv.slice(2);

if (!version || !tag || !x86 || !arm) {
  console.error(
    'Usage: render-flatpak-nightly.mjs <version> <tag> <x86_64-sha256:size> <aarch64-sha256:size> [date]'
  );
  process.exit(1);
}

const arches = parseArches(x86, arm, { sized: true });

const date = dateArg || new Date().toISOString().slice(0, 10);
const dir = 'packaging/flatpak/nightly';

let manifest = readFileSync(`${dir}/moe.sable.next.Nightly.yml.in`, 'utf8')
  .replaceAll('@VERSION@', version)
  .replaceAll('@TAG@', tag);

for (const [arch, values] of Object.entries(arches)) {
  const suffix = arch.toUpperCase();
  if (values) {
    manifest = manifest
      .replaceAll(`@SHA256_${suffix}@`, values.sha)
      .replaceAll(`@SIZE_${suffix}@`, String(values.size));
    continue;
  }
  const block = new RegExp(
    `      - type: extra-data\\n(?:        .*\\n)*?        only-arches: \\[${arch}\\]\\n`
  );
  if (!block.test(manifest)) {
    throw new Error(`Could not find the ${arch} extra-data source to drop.`);
  }
  manifest = manifest.replace(block, '');
}

assertSubstituted(manifest);

writeFileSync(`${dir}/moe.sable.next.Nightly.yml`, manifest);
writeFileSync(
  `${dir}/moe.sable.next.Nightly.metainfo.xml`,
  readFileSync(`${dir}/moe.sable.next.Nightly.metainfo.xml.in`, 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@DATE@', date)
);

console.log(`Rendered the nightly Flatpak manifest for ${version} (${date})`);
