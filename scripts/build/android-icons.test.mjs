import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const tauri = resolve(import.meta.dirname, '../../src-tauri');
const config = JSON.parse(readFileSync(join(tauri, 'app-icons.json'), 'utf8'));
const resources = join(dirname(resolve(tauri, config.android.manifest)), 'res');

test('icon generation writes to the Android app resource directory', () => {
  assert.equal(resolve(tauri, config.android.resourcesDirectory), resources);
});

for (const { id } of config.icons) {
  test(`Android bundles the ${id} launcher icon at every density`, () => {
    const name = `ic_launcher_${id}`;
    assert.ok(existsSync(join(resources, 'mipmap-anydpi-v26', `${name}.xml`)), name);
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      for (const suffix of ['', '_round', '_foreground']) {
        const image = join(resources, `mipmap-${density}`, `${name}${suffix}.png`);
        assert.ok(existsSync(image), image);
      }
    }
  });
}
