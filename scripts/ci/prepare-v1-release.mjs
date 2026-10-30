import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const v1Identifier = 'moe.sable.client';

export function prepareV1Release(root) {
  const configPath = join(root, 'src-tauri/tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const previous = config.identifier;
  if (![v1Identifier, 'moe.sable.next'].includes(previous))
    throw new Error(
      'Only the development or v1 production identity may be prepared for a stable upgrade'
    );
  const rewrite = (path, transform) => {
    if (existsSync(path)) writeFileSync(path, transform(readFileSync(path, 'utf8')));
  };
  const schemes = ['moe.sable.app', 'sable'];
  config.plugins['deep-link'].mobile[0].scheme = [...schemes, 'matrix'];
  rewrite(join(root, 'src-tauri/ios-project.yml'), (text) =>
    text.replace(/( *)- moe\.sable\.next\n/, (_, indent) =>
      schemes.map((scheme) => `${indent}- ${scheme}\n`).join('')
    )
  );
  config.identifier = v1Identifier;
  config.productName = 'Sable';
  config.mainBinaryName = 'sable';
  config.bundle.longDescription = 'Sable, a Matrix client.';
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

if (import.meta.main) {
  prepareV1Release(process.cwd());
  console.log('Prepared stable bundles for an in-place Sable v1 upgrade');
}
