// Usage: render-flatpak-stable.mjs <version> <x86_64-sha256> <aarch64-sha256>
// Pass "-" for an architecture that is not being published.

import { readFileSync, writeFileSync } from 'node:fs';
import { assertSubstituted, parseArches } from '../lib/flatpak.mjs';

const [version, x86, arm] = process.argv.slice(2);

if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !x86 || !arm) {
  console.error('Usage: render-flatpak-stable.mjs <version> <x86_64-sha256> <aarch64-sha256>');
  process.exit(1);
}

const arches = parseArches(x86, arm, { sized: false });

const dir = 'packaging/flatpak';
let manifest = readFileSync(`${dir}/moe.sable.client.yml.in`, 'utf8').replaceAll(
  '@VERSION@',
  version
);

for (const [arch, values] of Object.entries(arches)) {
  if (values) {
    manifest = manifest.replaceAll(`@SHA256_${arch.toUpperCase()}@`, values.sha);
    continue;
  }
  const block = new RegExp(
    `      - type: archive\\n(?:        .*\\n|          .*\\n)*?        only-arches: \\[${arch}\\]\\n(?:        x-checker-data:\\n(?:          .*\\n)*)?`
  );
  if (!block.test(manifest)) {
    throw new Error(`Could not find the ${arch} archive source to drop.`);
  }
  manifest = manifest.replace(block, '');
}

assertSubstituted(manifest);

writeFileSync(`${dir}/moe.sable.client.yml`, manifest);
console.log(`Rendered the stable Flatpak manifest for ${version}`);
