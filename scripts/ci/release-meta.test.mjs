import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { tauriVersionConfig } from './set-tauri-version.mjs';

test('nightly metadata handles a numeric SHA with a leading zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sable-release-meta-'));
  try {
    const output = join(dir, 'output');
    const result = spawnSync(process.execPath, ['scripts/ci/release-meta.mjs', output], {
      env: {
        ...process.env,
        EVENT_NAME: 'push',
        GIT_REF: 'refs/heads/main',
        GIT_SHA: '0998581289923621b1aa3b0059ba38fdadee9dfb',
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const version = /^version=(.+)$/m.exec(readFileSync(output, 'utf8'))[1];
    assert.match(version, /^\d+\.\d+\.\d+-nightly\.\d{12}\.g099858128992$/);
    assert.ok(tauriVersionConfig(version).bundle.android.versionCode > 1_000_000_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
