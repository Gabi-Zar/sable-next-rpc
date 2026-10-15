import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./build-updater-manifest.mjs', import.meta.url));

test('gives MSI installs their own Windows updater entry', async () => {
  const signed = ['sable-2.0.3-windows-x86_64.msi', 'sable-2.0.3-windows-x86_64-setup.exe'];
  const server = createServer((request, response) => {
    const { port } = server.address();
    if (request.url.endsWith('/releases/tags/v2.0.3')) {
      const assets = signed.map((name) => ({
        name: `${name}.sig`,
        browser_download_url: `http://127.0.0.1:${port}/download/${name}.sig`,
      }));
      response.end(JSON.stringify({ body: 'notes', assets }));
    } else {
      response.end(`signature of ${request.url.split('/').pop()}`);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = mkdtempSync(join(tmpdir(), 'sable-manifest-'));
  try {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: {
        ...process.env,
        FORGEJO_URL: `http://127.0.0.1:${server.address().port}`,
        FORGEJO_TOKEN: 'token',
        TAG: 'v2.0.3',
        VERSION: '2.0.3',
      },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const [status] = await once(child, 'exit');
    assert.equal(status, 0, stderr);
    const { platforms } = JSON.parse(readFileSync(join(root, 'latest.json'), 'utf8'));
    assert.match(platforms['windows-x86_64'].url, /-setup\.exe$/);
    assert.equal(
      platforms['windows-x86_64'].signature,
      'signature of sable-2.0.3-windows-x86_64-setup.exe.sig'
    );
    assert.match(platforms['windows-x86_64-msi'].url, /\.msi$/);
    assert.equal(
      platforms['windows-x86_64-msi'].signature,
      'signature of sable-2.0.3-windows-x86_64.msi.sig'
    );
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
