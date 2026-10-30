import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { browserCsp, cspHeader, inlineScripts, writeCspHeaders } from './csp.mjs';

const native = JSON.parse(
  await readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8')
).app.security.csp;

test('browser policy keeps worklets, custom CSS, fonts and widgets available', () => {
  const policy = browserCsp(native);
  assert.ok(policy['script-src'].split(' ').includes('blob:'));
  assert.ok(policy['script-src'].includes("'wasm-unsafe-eval'"));
  assert.ok(policy['style-src'].includes("'unsafe-inline'"));
  assert.ok(policy['font-src'].includes('https:'));
  assert.ok(policy['worker-src'].includes('blob:'));
  assert.ok(policy['frame-src'].includes('https:'));
  assert.equal(policy['frame-ancestors'], "'none'");
  assert.equal(policy['base-uri'], "'none'");
  assert.ok(!cspHeader(policy).includes('ipc:'));
  assert.ok(!cspHeader(policy).includes('sable-tiles'));
});

test('only inline script bodies receive bootstrap hashes', () => {
  const html = '<script src="/app.js">external</script><script type="module">\nboot();\n</script>';
  assert.deepEqual(inlineScripts(html), ['\nboot();\n']);
  const header = cspHeader(browserCsp(native), ['\nboot();\n', '\nboot();\n']);
  const hashes = header.match(/'sha256-[^']+'/g);
  assert.equal(hashes.length, 1);
  const scriptPolicy = header.split('; ').find((directive) => directive.startsWith('script-src '));
  assert.ok(!scriptPolicy.includes("'unsafe-inline'"));
  assert.ok(!scriptPolicy.includes("'unsafe-eval'"));
});

test('HTML parsing excludes inert script text and preserves exact inline bytes', () => {
  const body = '\r\nif (a < b) console.log("&amp;");\r\n';
  const html = `<!-- <script>comment()</script> -->
    <textarea><script>text()</script></textarea>
    <noscript><script>disabled()</script></noscript>
    <template><script>template()</script></template>
    <script data-src="metadata">${body}</script>
    <SCRIPT SRC = "/external.js">external()</SCRIPT>`;
  assert.deepEqual(inlineScripts(html), [body]);
});

test('Cloudflare and Caddy receive the same policy, including nested page bootstraps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sable-csp-'));
  try {
    await mkdir(join(directory, 'nested'));
    await writeFile(join(directory, 'index.html'), '<script>boot();</script>');
    await writeFile(join(directory, 'nested', 'index.html'), '<script>nested();</script>');
    await writeCspHeaders(directory, native);
    const headers = await readFile(join(directory, '_headers'), 'utf8');
    const policy = cspHeader(browserCsp(native), ['boot();', 'nested();']);
    assert.ok(headers.startsWith(`/*\n  Content-Security-Policy: ${policy}\n`));
    assert.ok(headers.includes('Cache-Control: public, max-age=31536000, immutable'));
    assert.equal(
      await readFile(join(directory, 'csp.caddy'), 'utf8'),
      `header Content-Security-Policy "${policy}"\n`
    );
    await writeCspHeaders(directory, native);
    assert.equal(await readFile(join(directory, '_headers'), 'utf8'), headers);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a policy that cannot fit in Cloudflare headers fails the build', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sable-csp-limit-'));
  try {
    await writeFile(
      join(directory, 'index.html'),
      Array.from({ length: 40 }, (_, i) => `<script>boot(${i});</script>`).join('')
    );
    await assert.rejects(writeCspHeaders(directory, native), /2000 bytes/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
