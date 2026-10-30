import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = 'packaging/flatpak/electron/nightly';
const id = 'moe.sable.next.electron.Nightly';
const sha = 'a'.repeat(64);

for (const arch of ['x86_64', 'aarch64']) {
  test(`nightly Flatpak publishes only the available ${arch} extra-data`, async (t) => {
    const cwd = await mkdtemp(join(tmpdir(), 'sable-flatpak-nightly-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    await mkdir(join(cwd, dir), { recursive: true });
    for (const suffix of ['yml.in', 'metainfo.xml.in']) {
      await copyFile(join(root, dir, `${id}.${suffix}`), join(cwd, dir, `${id}.${suffix}`));
    }
    execFileSync(
      process.execPath,
      [
        join(root, 'scripts/ci/render-flatpak-nightly.mjs'),
        '--electron',
        '2.2.3-nightly.20261030',
        'nightly-20261030',
        arch === 'x86_64' ? `${sha}:123` : '-',
        arch === 'aarch64' ? `${sha}:123` : '-',
        '2026-10-30',
      ],
      { cwd }
    );
    const manifest = parse(await readFile(join(cwd, dir, `${id}.yml`), 'utf8'));
    const module = manifest.modules.find((module) => module.name === 'sable-electron');
    const sources = module.sources.filter((source) => source.type === 'extra-data');
    assert.equal(sources.length, 1);
    assert.deepEqual(sources[0]['only-arches'], [arch]);
    assert.equal(sources[0].sha256, sha);
    assert.equal(sources[0].size, 123);
    assert.ok(module.sources.some((source) => source['dest-filename'] === 'apply_extra'));
    const metainfo = await readFile(join(cwd, dir, `${id}.metainfo.xml`), 'utf8');
    assert.match(metainfo, /version="2\.2\.3-nightly\.20261030" date="2026-10-30"/);
  });
}
