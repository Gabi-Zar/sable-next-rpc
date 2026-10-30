import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'electron/package.json'));
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { load } = createRequire(builderRequire.resolve('app-builder-lib/package.json'))('js-yaml');
const sha = 'a'.repeat(64);

{
  const dir = 'packaging/flatpak';
  const id = 'moe.sable.client';
  for (const [arch, artifactArch] of [
    ['x86_64', 'x64'],
    ['aarch64', 'arm64'],
  ]) {
    test(`Flatpak extracts ${arch} to the launcher path`, async (t) => {
      const cwd = await mkdtemp(join(tmpdir(), 'sable-flatpak-'));
      t.after(() => rm(cwd, { recursive: true, force: true }));
      await mkdir(join(cwd, dir), { recursive: true });
      await copyFile(join(root, dir, `${id}.yml.in`), join(cwd, dir, `${id}.yml.in`));
      execFileSync(
        process.execPath,
        [
          join(root, 'scripts/ci/render-flatpak-stable.mjs'),
          '2.1.4',
          arch === 'x86_64' ? sha : '-',
          arch === 'aarch64' ? sha : '-',
        ],
        { cwd }
      );
      const manifest = load(await readFile(join(cwd, dir, `${id}.yml`), 'utf8'));
      const module = manifest.modules.find((entry) => entry.name === 'sable');
      const sources = module.sources.filter((entry) => entry.type === 'archive');
      assert.equal(sources.length, 1);
      const source = sources[0];
      assert.deepEqual(source['only-arches'], [arch]);

      const archiveRoot = `sable-2.1.4-${artifactArch}`;
      await mkdir(join(cwd, archiveRoot, 'resources'), { recursive: true });
      await writeFile(join(cwd, archiveRoot, 'sable'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      await writeFile(join(cwd, archiveRoot, 'resources/app.asar'), 'app');
      execFileSync('tar', ['-czf', 'release.tar.gz', archiveRoot], { cwd });
      await mkdir(join(cwd, source.dest));
      execFileSync(
        'tar',
        [
          '-xzf',
          'release.tar.gz',
          `--strip-components=${source['strip-components']}`,
          '-C',
          source.dest,
        ],
        { cwd }
      );
      const app = join(cwd, 'app');
      await mkdir(app);
      const install = module['build-commands'].slice(0, 2).join('\n');
      execFileSync('sh', ['-ec', install], { cwd, env: { ...process.env, FLATPAK_DEST: app } });
      const bin = join(cwd, 'bin');
      await mkdir(bin);
      await writeFile(join(bin, 'zypak-wrapper'), '#!/bin/sh\nprintf "%s\\n" "$1"\n', {
        mode: 0o755,
      });
      const launcher = join(root, dir, 'sable.sh');
      const executable = execFileSync('sh', [launcher], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: 'utf8',
      }).trim();
      assert.ok(executable.startsWith('/app/'));
      execFileSync(join(app, executable.slice('/app/'.length)));
      assert.equal(await readFile(join(app, 'sable', 'resources/app.asar'), 'utf8'), 'app');
    });
  }
}
