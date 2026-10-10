import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SentryCli } from '@sentry/cli';

export async function collectMaps(root) {
  const entries = await readdir(root, { recursive: true }).catch(() => []);
  return entries.filter((entry) => entry.endsWith('.map')).map((entry) => join(root, entry));
}

async function main() {
  if (!process.env.VITE_SENTRY_DSN) return;
  for (const name of ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT', 'VITE_APP_VERSION']) {
    if (!process.env[name]) throw new Error(`${name} is required for source map uploads`);
  }
  const [assets = 'dist'] = process.argv.slice(2);
  execFileSync(
    SentryCli.getPath(),
    ['sourcemaps', 'upload', '--release', process.env.VITE_APP_VERSION, assets],
    { stdio: 'inherit' }
  );
  for (const root of [assets, '.svelte-kit/output']) {
    for (const map of await collectMaps(root)) await rm(map);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main();
