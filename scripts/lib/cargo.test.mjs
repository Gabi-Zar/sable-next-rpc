import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cargoPackageVersion, cargoRustFlags } from './cargo.mjs';

test('Cargo flags respect target sections and TOML escaping', () => {
  const config = `
    [target.wasm32-unknown-unknown]
    runner = "wasm-bindgen-test-runner"
    [target.aarch64-apple-darwin]
    rustflags = ["-C", 'target-cpu=native']
  `;
  assert.deepEqual(cargoRustFlags(config, 'wasm32-unknown-unknown'), []);
  assert.deepEqual(cargoRustFlags(config, 'aarch64-apple-darwin'), ['-C', 'target-cpu=native']);
  assert.deepEqual(
    cargoRustFlags(
      '[target.wasm32-unknown-unknown]\nrustflags = ["--cfg=feature=\\\"test\\\""]',
      'wasm32-unknown-unknown'
    ),
    ['--cfg=feature="test"']
  );
  assert.throws(
    () =>
      cargoRustFlags('[target.wasm32-unknown-unknown]\nrustflags = [1]', 'wasm32-unknown-unknown'),
    /array of strings/
  );
});

test('Cargo package lookup does not depend on field order or adjacent lines', () => {
  const lockfile = `
    version = 4
    [[package]]
    version = "0.2.1"
    # wasm-bindgen CLI must match this entry
    name = "wasm-bindgen"
    [[package]]
    name = "other"
    version = "1.0.0"
  `;
  assert.equal(cargoPackageVersion(lockfile, 'wasm-bindgen'), '0.2.1');
  assert.equal(cargoPackageVersion(lockfile, 'absent'), undefined);
});
