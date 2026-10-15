import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Ad-hoc: the edited Info.plist breaks Electron's own signature, and Apple
// Silicon will not launch an app without a valid one. Runs only where it was built.
export default function afterPack({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'darwin') return;
  const app = join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
}
