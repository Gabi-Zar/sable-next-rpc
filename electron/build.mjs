import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserCsp } from '../scripts/build/csp.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const release = process.argv.includes('--release');
const out = join(here, 'dist');

execFileSync(
  'cargo',
  ['build', '-p', 'sable-node', '-p', 'sable-audiofox', ...(release ? ['--release'] : [])],
  {
    cwd: root,
    stdio: 'inherit',
  }
);

const target = process.env.CARGO_TARGET_DIR ?? join(root, 'target');
mkdirSync(out, { recursive: true });
for (const name of ['sable_node', 'sable_audiofox']) {
  const library = {
    darwin: `lib${name}.dylib`,
    linux: `lib${name}.so`,
    win32: `${name}.dll`,
  }[process.platform];
  copyFileSync(join(target, release ? 'release' : 'debug', library), join(out, `${name}.node`));
}

const venmic = join(here, 'node_modules/@vencord/venmic/prebuilds');
for (const arch of ['x64', 'arm64']) {
  const prebuild = join(venmic, `venmic-addon-linux-${arch}`, 'node-napi-v7.node');
  if (existsSync(prebuild)) copyFileSync(prebuild, join(out, `venmic-${arch}.node`));
}

const { csp } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app
  .security;
const policy = browserCsp(csp);

await build({
  entryPoints: {
    main: join(here, 'src/main.ts'),
    preload: join(here, 'src/preload.ts'),
    'core-host': join(here, 'src/core-host.ts'),
    'audiofox-host': join(here, 'src/audiofox-host.ts'),
  },
  outdir: out,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  external: ['electron', './sable_node.node'],
  define: {
    __SABLE_CSP__: JSON.stringify(policy),
    __SABLE_IDENTIFIER__: JSON.stringify(process.env.SABLE_IDENTIFIER ?? 'moe.sable.next'),
    __SABLE_SENTRY__: JSON.stringify({
      dsn: process.env.VITE_SENTRY_DSN,
      environment: process.env.VITE_SENTRY_ENVIRONMENT,
      release: process.env.VITE_APP_VERSION,
    }),
  },
  sourcemap: true,
});
