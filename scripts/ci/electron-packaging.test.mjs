import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import afterPack from '../../electron/after-pack.mjs';

const electronDir = fileURLToPath(new URL('../../electron/', import.meta.url));
const require = createRequire(join(electronDir, 'package.json'));
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const { Packager } = builderRequire('app-builder-lib/out/packager');
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo');
const { LinuxPackager } = builderRequire('app-builder-lib/out/linuxPackager');
const { WinPackager } = builderRequire('app-builder-lib/out/winPackager');
const { createElectronFrameworkSupport } = builderRequire(
  'app-builder-lib/out/electron/ElectronFramework'
);

for (const electronPlatformName of ['win32', 'linux']) {
  for (const flavor of ['stable', 'nightly']) {
    test(`${flavor} ${electronPlatformName} packaging keeps Chromium locales`, async (t) => {
      const appOutDir = await mkdtemp(join(tmpdir(), 'sable-electron-locales-'));
      t.after(() => rm(appOutDir, { recursive: true, force: true }));
      const locales = [
        'en-US.pak',
        'en-GB.pak',
        'es-419.pak',
        'pt-BR.pak',
        'pt-PT.pak',
        'fr.pak',
        'zh-CN.pak',
      ];
      await mkdir(join(appOutDir, 'locales'));
      for (const locale of locales) {
        await writeFile(join(appOutDir, 'locales', locale), locale);
      }
      await writeFile(
        join(appOutDir, electronPlatformName === 'win32' ? 'electron.exe' : 'electron'),
        ''
      );

      const info = new Packager({
        projectDir: electronDir,
        config: join(electronDir, `electron-builder.${flavor}.yml`),
      });
      t.after(() => info.tempDirManager.cleanup());
      await info.validateConfig();
      info._appInfo = new AppInfo(info, null);
      const packager =
        electronPlatformName === 'win32' ? new WinPackager(info) : new LinuxPackager(info);
      const framework = await createElectronFrameworkSupport(info.config, info);
      await framework.beforeCopyExtraFiles({ appOutDir, packager });

      assert.deepEqual((await readdir(join(appOutDir, 'locales'))).sort(), locales.sort());
    });
  }

  test(`${electronPlatformName} packaging requires en-US.pak`, async (t) => {
    const appOutDir = await mkdtemp(join(tmpdir(), 'sable-electron-locales-'));
    t.after(() => rm(appOutDir, { recursive: true, force: true }));
    await mkdir(join(appOutDir, 'locales'));
    await writeFile(join(appOutDir, 'locales', 'fr.pak'), 'French');
    let fused = false;
    const context = {
      electronPlatformName,
      appOutDir,
      packager: {
        generateFuseConfig: (config) => config,
        addElectronFuses: () => {
          fused = true;
        },
      },
    };

    await assert.rejects(afterPack(context), { code: 'ENOENT' });
    assert.equal(fused, false);

    await writeFile(join(appOutDir, 'locales', 'en-US.pak'), 'English');
    await afterPack(context);
    assert.equal(fused, true);
  });
}
