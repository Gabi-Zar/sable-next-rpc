import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const release = process.argv.includes('--release');
const out = join(here, 'dist');

execFileSync('cargo', ['build', '-p', 'sable-node', ...(release ? ['--release'] : [])], {
  cwd: root,
  stdio: 'inherit',
});

const library = {
  darwin: 'libsable_node.dylib',
  linux: 'libsable_node.so',
  win32: 'sable_node.dll',
}[process.platform];
const target = process.env.CARGO_TARGET_DIR ?? join(root, 'target');
mkdirSync(out, { recursive: true });
copyFileSync(join(target, release ? 'release' : 'debug', library), join(out, 'sable_node.node'));

const venmic = join(here, 'node_modules/@vencord/venmic/prebuilds');
for (const arch of ['x64', 'arm64']) {
  const prebuild = join(venmic, `venmic-addon-linux-${arch}`, 'node-napi-v7.node');
  if (existsSync(prebuild)) copyFileSync(prebuild, join(out, `venmic-${arch}.node`));
}

const tauriOnly = /^(ipc:|http:\/\/ipc\.localhost|sable-tiles:|http:\/\/sable-tiles\.localhost)$/;
const { csp } = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).app
  .security;
const policy = Object.fromEntries(
  Object.entries(csp).map(([directive, sources]) => [
    directive,
    sources
      .split(' ')
      .filter((source) => !tauriOnly.test(source))
      .join(' '),
  ])
);

await build({
  entryPoints: {
    main: join(here, 'src/main.ts'),
    preload: join(here, 'src/preload.ts'),
    'core-host': join(here, 'src/core-host.ts'),
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
    __SABLE_SENTRY__: JSON.stringify({
      dsn: process.env.VITE_SENTRY_DSN,
      environment: process.env.VITE_SENTRY_ENVIRONMENT,
      release: process.env.VITE_APP_VERSION,
    }),
  },
  sourcemap: true,
});
