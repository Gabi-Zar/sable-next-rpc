import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const version =
  process.env.VERSION || JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')).version;
const builder = createRequire(import.meta.url).resolve('electron-builder/cli.js');

execFileSync(process.execPath, [join(here, 'build.mjs'), '--release'], { stdio: 'inherit' });
execFileSync(
  process.execPath,
  [builder, '--publish', 'never', `-c.extraMetadata.version=${version}`, ...process.argv.slice(2)],
  { cwd: here, stdio: 'inherit' }
);
