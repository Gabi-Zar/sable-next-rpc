/**
 * Passes through to the Tauri CLI, except that a leading `wry` or `cef` before
 * `dev` or `build` selects the desktop runtime:
 *
 *   node scripts/build/tauri.mjs cef build
 *     -> tauri build --no-bundle --features cef -- --no-default-features
 */

import { run } from '@tauri-apps/cli';
import { join } from 'node:path';

process.chdir(join(import.meta.dirname, '../..'));

const RUNTIMES = new Set(['wry', 'cef']);

function resolveArgs(argv) {
  const [runtime, command, ...rest] = argv;
  if (!RUNTIMES.has(runtime) || !['dev', 'build'].includes(command)) return argv;

  const args = [command];
  if (runtime === 'cef' && command === 'build' && !rest.includes('--no-bundle')) {
    args.push('--no-bundle');
  }
  args.push('--features', runtime, ...rest);
  // Everything after `--` reaches cargo, which is where the features live.
  if (!rest.includes('--')) args.push('--');
  args.push('--no-default-features');
  return args;
}

await run(resolveArgs(process.argv.slice(2)), 'tauri');
