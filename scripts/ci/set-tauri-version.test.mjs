import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ci/set-tauri-version.mjs');

function withConfig(run) {
  const root = mkdtempSync(join(tmpdir(), 'sable-version-'));
  const file = join(root, 'src-tauri/tauri.conf.json');
  mkdirSync(join(root, 'src-tauri'));
  writeFileSync(file, JSON.stringify({ bundle: { android: { versionCode: 1_792_670_400 } } }));
  try {
    run((version) => {
      const result = spawnSync(process.execPath, [script, version], {
        cwd: root,
        encoding: 'utf8',
      });
      return { ...result, config: JSON.parse(readFileSync(file, 'utf8')) };
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('stable updates exceed released standard and FOSS version codes', () => {
  withConfig((stamp) => {
    let previous = 20_000_032;
    for (const version of ['2.1.4', '2.1.5', '2.2.0', '3.0.0']) {
      const result = stamp(version);
      assert.equal(result.status, 0, result.stderr);
      const base = result.config.bundle.android.versionCode;
      for (const abi of [0, 1, 2, 3, 4]) assert.ok(base + abi > previous);
      previous = base + 4;
    }
    assert.equal(stamp('2.1.4').config.bundle.android.versionCode, 20_010_040);
  });
});

test('nightly codes remain timestamp-based and stable stamping clears them', () => {
  withConfig((stamp) => {
    const first = stamp('2.1.4-nightly.261022120000');
    assert.equal(first.status, 0, first.stderr);
    const base = first.config.bundle.android.versionCode;
    assert.equal(base, Date.UTC(2026, 9, 22, 12) / 1000);
    assert.ok(base + 4 < 2_100_000_000);
    assert.ok(stamp('2.1.4-nightly.261022120001').config.bundle.android.versionCode > base);
    assert.equal(stamp('2.1.4').config.bundle.android.versionCode, 20_010_040);
  });
});

test('unrepresentable versions fail without changing the config', () => {
  withConfig((stamp) => {
    for (const version of ['210.0.0', '2.1000.0', '2.0.1000']) {
      const result = stamp(version);
      assert.notEqual(result.status, 0);
      assert.equal(result.config.bundle.android.versionCode, 1_792_670_400);
    }
  });
});
