import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const tauri = resolve(import.meta.dirname, '../../src-tauri');
const read = (path) => readFileSync(join(tauri, path), 'utf8');

test('the Android package, JNI exports and Tauri identifier stay on the v1 identity', () => {
  const { identifier } = JSON.parse(read('tauri.android.conf.json'));
  assert.equal(identifier, 'moe.sable.client');
  const sources = `gen/android/app/src/main/java/${identifier.replaceAll('.', '/')}`;
  assert.ok(read(`${sources}/MainActivity.kt`).startsWith(`package ${identifier}\n`));
  assert.ok(
    existsSync(join(tauri, `gen/android/buildSrc/src/main/java/${identifier.replaceAll('.', '/')}`))
  );
  assert.match(read('gen/android/app/build.gradle.kts'), new RegExp(`namespace = "${identifier}"`));
  assert.ok(
    read('gen/android/app/src/main/res/xml/shortcuts.xml').includes(`"${identifier}.MainActivity"`)
  );
  const mobile = read('src/mobile.rs');
  assert.ok(mobile.includes(`Java_${identifier.replaceAll('.', '_')}_MainActivity`));
  assert.ok(!/Java_moe_sable_next_|moe\/sable\/next\//.test(mobile));
});

test('every Android package ID has a Firebase client', () => {
  const firebase = JSON.parse(read('gen/android/app/google-services.json')).client.map(
    (client) => client.client_info.android_client_info.package_name
  );
  for (const packageName of [
    'moe.sable.client',
    'moe.sable.client.debug',
    'moe.sable.next.nightly',
  ]) {
    assert.ok(firebase.includes(packageName), `google-services.json lacks ${packageName}`);
  }
});
