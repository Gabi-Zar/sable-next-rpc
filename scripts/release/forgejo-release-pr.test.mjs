import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const script = fileURLToPath(new URL('./forgejo-release-pr.mjs', import.meta.url));
const execFileAsync = promisify(execFile);

function releaseTree(version) {
  const root = mkdtempSync(join(tmpdir(), 'sable-release-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', version }));
  writeFileSync(
    join(root, 'CHANGELOG.md'),
    `# Changelog\n\n## ${version} (2026-10-21)\n\n### Fixes\n\n* Fix a thing.\n`
  );
  return root;
}

async function runRelease(handler, args) {
  const requests = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body,
      });
      handler(requests.length, response);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = releaseTree('2.1.2');
  try {
    const { port } = server.address();
    const result = await execFileAsync(process.execPath, [script, 'release', ...args], {
      cwd: root,
      env: {
        ...process.env,
        FORGEJO_URL: `http://127.0.0.1:${port}`,
        FORGEJO_TOKEN: 'test-token',
      },
    });
    return { result, requests };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
}

test('the release is created with the changelog body and a header token', async () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const { result, requests } = await runRelease(
    (requestNumber, response) => {
      if (requestNumber === 1) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end('{"message":"release not found"}');
        return;
      }
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end('{"id":1}');
    },
    [sha]
  );

  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, '/api/v1/repos/SableClient/sable-next/releases/tags/v2.1.2');

  assert.equal(requests[1].method, 'POST');
  assert.equal(requests[1].url, '/api/v1/repos/SableClient/sable-next/releases');
  assert.equal(requests[1].authorization, 'token test-token');
  const release = JSON.parse(requests[1].body);
  assert.equal(release.tag_name, 'v2.1.2');
  assert.equal(release.name, 'v2.1.2');
  assert.equal(release.target_commitish, sha);
  assert.match(release.body, /Fix a thing\./);
  assert.match(result.stdout, /Created release v2\.1\.2/);
});

test('an existing release is left alone', async () => {
  const { result, requests } = await runRelease(
    (_requestNumber, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"id":1,"tag_name":"v2.1.2"}');
    },
    ['0123456789abcdef0123456789abcdef01234567']
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.match(result.stdout, /already exists/);
});
