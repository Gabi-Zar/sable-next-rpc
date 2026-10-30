// Usage: render-flatpak-stable.mjs <version> <x86_64-sha256> <aarch64-sha256>
// Pass "-" for an architecture that is not being published.

import { readFileSync, writeFileSync } from 'node:fs';
import { flatpakTarget, parseArches, renderSources } from '../lib/flatpak.mjs';

const { dir, id } = flatpakTarget('stable');
const [version, x86, arm] = process.argv.slice(2);

if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !x86 || !arm) {
  console.error('Usage: render-flatpak-stable.mjs <version> <x86_64-sha256> <aarch64-sha256>');
  process.exit(1);
}

const arches = parseArches(x86, arm, { sized: false });

const manifest = renderSources(
  readFileSync(`${dir}/${id}.yml.in`, 'utf8').replaceAll('@VERSION@', version),
  arches,
  'archive'
);

writeFileSync(`${dir}/${id}.yml`, manifest);
console.log(`Rendered the stable Flatpak manifest for ${version}`);
