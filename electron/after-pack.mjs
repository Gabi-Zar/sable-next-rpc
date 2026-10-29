import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

const fuses = {
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: false,
};

export default async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName === 'win32' || electronPlatformName === 'linux') {
    await access(join(appOutDir, 'locales', 'en-US.pak'));
  }
  await packager.addElectronFuses(context, await packager.generateFuseConfig(fuses));

  if (electronPlatformName !== 'darwin' || packager.platformSpecificBuildOptions.identity) return;
  const app = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
}
