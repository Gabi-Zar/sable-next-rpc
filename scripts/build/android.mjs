import { spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'string', short: 'v' },
  },
});

function usage() {
  console.log(`Usage: pnpm android:build [--version <version>]

Builds a FOSS, split aarch64 Android APK. The version defaults to package.json.
Requires pnpm, Rust, an Android SDK/NDK and binaryen's wasm-opt on PATH.`);
}

if (values.help) {
  usage();
  process.exit(0);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is required on PATH`);
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.trim();
}

const version = (
  values.version ?? JSON.parse(readFileSync('package.json', 'utf8')).version
).replace(/^v/, '');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`--version must be a semver version (got ${version})`);
}

const lockfile = readFileSync('Cargo.lock', 'utf8');
const wasmBindgenVersion = lockfile.match(/name = "wasm-bindgen"\r?\nversion = "([^"]+)"/)?.[1];
if (!wasmBindgenVersion) throw new Error('Cargo.lock does not contain wasm-bindgen');

run('rustup', ['target', 'add', 'wasm32-unknown-unknown', 'aarch64-linux-android']);

const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');
process.env.PATH = [cargoBin, process.env.PATH].filter(Boolean).join(delimiter);

if (capture('wasm-bindgen', ['--version']) !== `wasm-bindgen ${wasmBindgenVersion}`) {
  run('cargo', ['install', 'wasm-bindgen-cli', '--version', wasmBindgenVersion, '--locked']);
}
if (!capture('wasm-opt', ['--version'])) throw new Error("binaryen's wasm-opt is required on PATH");

const config = 'src-tauri/tauri.conf.json';
const originalConfig = readFileSync(config, 'utf8');
const geolocation = 'src-tauri/capabilities/geolocation.json';
const disabledGeolocation = `${geolocation}.android-build-disabled`;
renameSync(geolocation, disabledGeolocation);

try {
  run('node', ['scripts/ci/set-tauri-version.mjs', version]);
  const projectRoot = process.cwd();
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), '.cargo');
  const rustupHome = process.env.RUSTUP_HOME ?? join(homedir(), '.rustup');
  const env = {
    ...process.env,
    SABLE_FOSS: '1',
    SABLE_BUILD_FLAVOR: 'stable',
    VITE_APP_VERSION: version,
    RUSTFLAGS: [
      process.env.RUSTFLAGS,
      `--remap-path-prefix=${projectRoot}=/usr/src/sable`,
      `--remap-path-prefix=${cargoHome}=/usr/local/cargo`,
      `--remap-path-prefix=${rustupHome}=/usr/local/rustup`,
    ]
      .filter(Boolean)
      .join(' '),
  };
  run(
    'pnpm',
    [
      'tauri',
      'android',
      'build',
      '--apk',
      '--split-per-abi',
      '--target',
      'aarch64',
      '--',
      '--no-default-features',
      '--features',
      'wry',
    ],
    { env }
  );
} finally {
  writeFileSync(config, originalConfig);
  renameSync(disabledGeolocation, geolocation);
}
