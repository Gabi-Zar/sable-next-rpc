#!/usr/bin/env node

// `mise exec` resolves every tool in .mise/config.toml before it runs anything, which
// drags the wasm toolchain into jobs that only need a lockfile install.
// CI has no use for git hooks anyway, and neither do source builds without mise.

import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.env.CI) process.exit(0);

if (spawnSync('mise', ['--version'], { stdio: 'ignore' }).status !== 0) process.exit(0);

const { status } = spawnSync('mise', ['exec', '--', 'lefthook', 'install', '--force'], {
  stdio: 'inherit',
});
process.exit(status ?? 1);
