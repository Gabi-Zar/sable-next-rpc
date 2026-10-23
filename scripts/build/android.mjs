import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parseArgs } from 'node:util';
import { downloadVerified } from '../lib/download.mjs';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'string', short: 'v' },
  },
});

function usage() {
  console.log(`Usage: pnpm android:build [--version <version>]

Builds a FOSS, split aarch64 Android APK. The version defaults to package.json.
Requires pnpm, Rust, an Android SDK/NDK and tar.
Installs wasm-bindgen-cli from Cargo.lock and Binaryen from .mise/mise.lock as needed.`);
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

const binaryenBin = await ensureBinaryen();
if (binaryenBin) process.env.PATH = [binaryenBin, process.env.PATH].filter(Boolean).join(delimiter);

if (capture('wasm-bindgen', ['--version']) !== `wasm-bindgen ${wasmBindgenVersion}`) {
  run('cargo', ['install', 'wasm-bindgen-cli', '--version', wasmBindgenVersion, '--locked']);
}

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

async function ensureBinaryen() {
  const lock = readFileSync('.mise/mise.lock', 'utf8');
  const tool = lock.split('[[tools."github:WebAssembly/binaryen"]]')[1]?.split('[[tools.')[0];
  const version = tool?.match(/^version = "([^"]+)"/m)?.[1];
  if (!version) throw new Error('Binaryen is missing from .mise/mise.lock');

  const matches = (command) => capture(command, ['--version'])?.split(/\s+/)[2] === version;
  if (matches('wasm-opt')) return undefined;

  const platform = `${process.platform === 'darwin' ? 'macos' : process.platform}-${process.arch}`;
  const entry = tool
    .split(`[tools."github:WebAssembly/binaryen"."platforms.${platform}"]`)[1]
    ?.split('\n[')[0];
  const url = entry?.match(/^url = "([^"]+)"/m)?.[1];
  const checksum = entry?.match(/^checksum = "sha256:([a-f0-9]{64})"/m)?.[1];
  if (!url || !checksum) throw new Error(`No locked Binaryen download for ${platform}`);

  const cache = join(process.cwd(), 'node_modules/.cache/binaryen');
  const target = join(cache, `${version}-${platform}-${checksum}`);
  const bin = join(target, 'bin');
  const executable = process.platform === 'win32' ? 'wasm-opt.exe' : 'wasm-opt';
  if (matches(join(bin, executable))) return bin;

  const archive = await downloadVerified(url, checksum);
  mkdirSync(cache, { recursive: true });
  const temporary = mkdtempSync(join(cache, '.tmp-'));
  try {
    const archivePath = join(temporary, 'binaryen.tar.gz');
    writeFileSync(archivePath, archive);
    run('tar', ['-xzf', archivePath, '-C', temporary]);
    const extracted = join(temporary, `binaryen-version_${version}`);
    if (!matches(join(extracted, 'bin', executable))) {
      throw new Error(`Downloaded wasm-opt does not run as Binaryen ${version}`);
    }
    rmSync(target, { recursive: true, force: true });
    renameSync(extracted, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  return bin;
}
