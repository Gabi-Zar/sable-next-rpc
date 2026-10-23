import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { collectSymbols } from './upload-sentry-symbols.mjs';

test('finds app symbols and excludes dependencies and bundles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sable-symbols-'));
  try {
    const files = [
      'release/app',
      'release/app.pdb',
      'electron/dist/sable_node.node',
      'electron/dist/sable_audiofox.node',
      'electron/dist/venmic-x64.node',
      'aarch64-linux-android/release/libapp_lib.so',
      'release/deps/libdependency.so',
      'release/bundle/app',
      'debug/app',
      'build/archive/Sable.app.dSYM/Contents/Resources/DWARF/Sable',
      'build/archive/Sentry.framework.dSYM/Contents/Resources/DWARF/Sentry',
    ];
    for (const file of files) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), 'fixture');
    }
    assert.deepEqual((await collectSymbols(root)).map((path) => relative(root, path)).sort(), [
      'aarch64-linux-android/release/libapp_lib.so',
      'build/archive/Sable.app.dSYM',
      'electron/dist/sable_audiofox.node',
      'electron/dist/sable_node.node',
      'release/app',
      'release/app.pdb',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'validates Electron addon debug data and matching macOS dSYMs',
  {
    skip: !['linux', 'darwin'].includes(process.platform) || spawnSync('cc', ['--version']).error,
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sable-addon-symbols-'));
    try {
      const dist = join(root, 'dist');
      const source = join(root, 'addon.c');
      const binary = join(dist, 'sable_node.node');
      await mkdir(dist);
      await writeFile(source, 'int fixture(void) { return 1; }');
      const object = join(root, 'addon.o');
      const build = () => {
        execFileSync('cc', ['-g', '-fPIC', '-c', source, '-o', object]);
        execFileSync('cc', [
          '-g',
          ...(process.platform === 'darwin' ? ['-dynamiclib'] : ['-shared', '-Wl,--build-id']),
          object,
          '-o',
          binary,
        ]);
      };
      build();
      const dsym = `${binary}.dSYM`;
      if (process.platform === 'darwin') await rm(dsym, { recursive: true, force: true });
      const validate = () =>
        execFileSync(
          process.execPath,
          [join(import.meta.dirname, 'upload-sentry-symbols.mjs'), '--dry-run', dist],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );
      assert.match(validate(), /Validated 1 debug identifiers/);
      if (process.platform === 'darwin') {
        const savedDsym = join(root, 'previous.dSYM');
        await rename(dsym, savedDsym);
        await writeFile(source, 'int fixture(void) { return 2; }');
        build();
        await rm(dsym, { recursive: true, force: true });
        await rename(savedDsym, dsym);
        assert.throws(validate, /Debug identifiers do not match/);
      } else {
        execFileSync('strip', ['--strip-debug', binary]);
        assert.throws(validate, /Missing usable debug information/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test('fails when a symbol directory cannot be read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sable-symbols-'));
  try {
    await assert.rejects(collectSymbols(join(root, 'missing')), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'validates debug data and requires every build output',
  {
    skip:
      process.platform !== 'linux' ||
      ['cc', 'strip'].some((tool) => spawnSync(tool, ['--version']).error),
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'sable-symbols-'));
    try {
      const release = join(root, 'release');
      const source = join(root, 'main.c');
      const binary = join(release, 'app');
      await mkdir(release);
      await writeFile(source, 'int main(void) { return 0; }');
      execFileSync('cc', ['-g', '-Wl,--build-id', source, '-o', binary]);
      const script = join(import.meta.dirname, 'upload-sentry-symbols.mjs');
      const validate = (...paths) =>
        execFileSync(process.execPath, [script, '--dry-run', ...paths], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            VITE_SENTRY_DSN: 'https://public@example.invalid/1',
            SENTRY_AUTH_TOKEN: '',
            SENTRY_ORG: '',
            SENTRY_PROJECT: '',
            SENTRY_URL: 'http://127.0.0.1:1',
          },
        });
      assert.match(validate(release), /Validated 1 debug identifiers/);
      const missingAbi = join(root, 'armv7', 'release');
      await mkdir(missingAbi, { recursive: true });
      assert.throws(() => validate(release, missingAbi), /No native symbols found/);
      assert.throws(() => validate('--ios', release), /Missing iOS app dSYM/);
      execFileSync('strip', ['--strip-debug', binary]);
      assert.throws(() => validate(release), /Missing usable debug information/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);
