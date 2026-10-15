import { execFileSync } from 'node:child_process';
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
  await packager.addElectronFuses(context, await packager.generateFuseConfig(fuses));

  if (electronPlatformName !== 'darwin') return;
  const app = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
}
