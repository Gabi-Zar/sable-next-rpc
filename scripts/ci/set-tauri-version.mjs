import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

export function tauriVersionConfig(version, updaterEndpoint) {
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
    : // Keep standard APKs on the same scale as previously released FOSS APKs.
      version
        .split(/[.-]/)
        .slice(0, 3)
        .reduce((code, part) => code * 1000 + Number(part), 0) * 10;

  if (
    version
      .split(/[.-]/)
      .slice(1, 3)
      .some((part) => Number(part) >= 1000)
  ) {
    throw new Error('Android versions require minor and patch numbers below 1000');
  }

  if (
    !Number.isSafeInteger(androidVersionCode) ||
    androidVersionCode < 1 ||
    androidVersionCode + 4 > 2_100_000_000
  ) {
    throw new Error(`Android version code is out of range: ${androidVersionCode}`);
  }

  return {
    version,
    ...(updaterEndpoint && { plugins: { updater: { endpoints: [updaterEndpoint] } } }),
    bundle: { android: { versionCode: androidVersionCode } },
  };
}

if (import.meta.main) {
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

  const patch = tauriVersionConfig(version, updaterEndpoint);
  const file = 'src-tauri/tauri.conf.json';
  const config = JSON.parse(readFileSync(file, 'utf8'));
  config.version = patch.version;
  if (patch.plugins) {
    config.plugins ??= {};
    config.plugins.updater ??= {};
    config.plugins.updater.endpoints = patch.plugins.updater.endpoints;
  }
  config.bundle ??= {};
  config.bundle.android ??= {};
  config.bundle.android.versionCode = patch.bundle.android.versionCode;
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Set ${file} version to ${version}`);
}
