import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

const v1Identifier = 'moe.sable.client';

export function prepareV1Release(root) {
  const configPath = join(root, 'src-tauri/tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const previous = config.identifier;
  if (![v1Identifier, 'moe.sable.next'].includes(previous))
    throw new Error(
      'Only the development or v1 production identity may be prepared for a stable upgrade'
    );
  const previousPath = previous.replaceAll('.', '/');
  const packagePath = v1Identifier.replaceAll('.', '/');
  const rewrite = (path, transform) => {
    if (existsSync(path)) writeFileSync(path, transform(readFileSync(path, 'utf8')));
  };
  for (const location of ['app', 'buildSrc']) {
    const base = join(root, `src-tauri/gen/android/${location}/src/main/java`);
    const source = join(base, previousPath);
    const target = join(base, packagePath);
    if (!existsSync(source)) continue;
    if (source !== target && existsSync(target))
      throw new Error('The production Android package path is already occupied');
    for (const file of readdirSync(source, { recursive: true })) {
      if (file.endsWith('.kt'))
        rewrite(join(source, file), (text) => text.replaceAll(previous, v1Identifier));
    }
    if (source !== target) {
      mkdirSync(dirname(target), { recursive: true });
      renameSync(source, target);
    }
  }
  rewrite(join(root, 'src-tauri/gen/android/app/build.gradle.kts'), (text) =>
    text.replaceAll(previous, v1Identifier)
  );
  rewrite(join(root, 'src-tauri/gen/android/app/src/main/res/xml/shortcuts.xml'), (text) =>
    text.replaceAll(previous, v1Identifier)
  );
  rewrite(join(root, 'src-tauri/src/mobile.rs'), (text) =>
    text
      .replaceAll(
        `Java_${previous.replaceAll('.', '_')}_MainActivity`,
        'Java_moe_sable_client_MainActivity'
      )
      .replaceAll(`${previousPath}/MainActivity`, 'moe/sable/client/MainActivity')
  );
  rewrite(join(root, 'src-tauri/src/main.rs'), (text) =>
    text.replaceAll(`identifier: "${previous}"`, `identifier: "${v1Identifier}"`)
  );
  rewrite(join(root, 'src-tauri/gen/android/app/src/main/res/values/strings.xml'), (text) =>
    text.replaceAll('"sable-next"', '"Sable"')
  );
  const schemes = ['moe.sable.app', 'sable'];
  config.plugins['deep-link'].desktop.schemes = [...schemes, 'matrix'];
  config.plugins['deep-link'].mobile[0].scheme = [...schemes, 'matrix'];
  rewrite(join(root, 'src-tauri/gen/android/app/src/main/AndroidManifest.xml'), (text) =>
    text.replace(/( *)<data android:scheme="moe\.sable\.next" \/>\n/, (_, indent) =>
      schemes.map((scheme) => `${indent}<data android:scheme="${scheme}" />\n`).join('')
    )
  );
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
