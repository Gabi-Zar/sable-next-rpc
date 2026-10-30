import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { renderSources } from './flatpak.mjs';

const sha = 'a'.repeat(64);

test('drops a source by its architecture despite reordered keys, comments and nested data', () => {
  const template = `# Keep the runtime comment
runtime: org.freedesktop.Platform
modules:
  - name: app
    sources:
      - only-arches:
          - x86_64
        x-checker-data:
          type: json
          url: https://example.org/releases
        url: https://example.org/x64.tar.gz
        type: archive
        sha256: '@SHA256_X86_64@'
      - only-arches: [aarch64]
        sha256: '@SHA256_AARCH64@'
        type: archive
        url: https://example.org/arm64.tar.gz
      - type: file
        path: launcher.sh
`;
  const output = renderSources(
    template.replaceAll('\n', '\r\n'),
    {
      x86_64: null,
      aarch64: { sha },
    },
    'archive'
  );
  assert.match(output, /# Keep the runtime comment/);
  assert.deepEqual(parse(output).modules[0].sources, [
    {
      'only-arches': ['aarch64'],
      sha256: sha,
      type: 'archive',
      url: 'https://example.org/arm64.tar.gz',
    },
    { type: 'file', path: 'launcher.sh' },
  ]);
});

test('renders extra-data sizes as numbers and removes unpublished architectures', () => {
  const output = renderSources(
    `modules:
  - name: app
    sources:
      - type: extra-data
        only-arches: [x86_64]
        sha256: '@SHA256_X86_64@'
        size: @SIZE_X86_64@
      - type: extra-data
        only-arches: [aarch64]
        sha256: '@SHA256_AARCH64@'
        size: @SIZE_AARCH64@
`,
    { x86_64: { sha, size: 123 }, aarch64: null },
    'extra-data'
  );
  assert.deepEqual(parse(output).modules[0].sources, [
    { type: 'extra-data', 'only-arches': ['x86_64'], sha256: sha, size: 123 },
  ]);
});

test('fails when an unpublished architecture is missing or the template is malformed', () => {
  assert.throws(
    () => renderSources('modules: []', { x86_64: null }, 'archive'),
    /Could not find the x86_64 archive source/
  );
  assert.throws(() => renderSources('modules: [', {}, 'archive'));
  assert.throws(
    () => renderSources('version: "@VERSION@"', {}, 'archive'),
    /Unsubstituted placeholder/
  );
});

test('keeps a shared source for its remaining architecture inside nested modules', () => {
  const output = renderSources(
    `modules:
  - name: parent
    modules:
      - name: child
        sources:
          - type: archive
            only-arches: [x86_64, aarch64]
            url: https://example.org/universal.tar.gz
`,
    { x86_64: null, aarch64: { sha } },
    'archive'
  );
  assert.deepEqual(parse(output).modules[0].modules[0].sources[0]['only-arches'], ['aarch64']);
});
