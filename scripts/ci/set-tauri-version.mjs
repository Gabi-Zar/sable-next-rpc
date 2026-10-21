import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const {
  values: { 'updater-endpoint': updaterEndpoint },
  positionals: [version],
} = parseArgs({
  options: {
    'updater-endpoint': { type: 'string' },
  },
  allowPositionals: true,
});

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(
    `Usage: set-tauri-version.mjs <version> [--updater-endpoint=<url>]  (got: ${version ?? '<none>'})`
  );
  process.exit(1);
}

const nightlyVersion =
  /^(\d+)\.(\d+)\.(\d+)-nightly\.(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.[0-9a-f]+)?$/.exec(
    version
  );
const androidVersionCode = nightlyVersion
  ? Date.UTC(
      2000 + +nightlyVersion[4],
      +nightlyVersion[5] - 1,
      +nightlyVersion[6],
      +nightlyVersion[7],
      +nightlyVersion[8],
      +nightlyVersion[9]
    ) / 1000
  : undefined;

const file = 'src-tauri/tauri.conf.json';
const config = JSON.parse(readFileSync(file, 'utf8'));
config.version = version;
if (updaterEndpoint) {
  config.plugins ??= {};
  config.plugins.updater ??= {};
  config.plugins.updater.endpoints = [updaterEndpoint];
}
if (androidVersionCode) {
  config.bundle ??= {};
  config.bundle.android ??= {};
  config.bundle.android.versionCode = androidVersionCode;
}
writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Set ${file} version to ${version}`);
