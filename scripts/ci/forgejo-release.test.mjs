import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

async function download(t, pattern, ...flags) {
  const directory = await mkdtemp(join(tmpdir(), 'sable-release-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const names = ['sable-1.tar.gz', 'sable-.tar.gz', 'sable-11.tar.gz', 'other-1.tar.gz'];
  const downloads = [];
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url.startsWith('/api/')) {
      const origin = `http://127.0.0.1:${server.address().port}`;
      response.end(
        JSON.stringify({
          assets: names.map((name) => ({ name, browser_download_url: `${origin}/${name}` })),
        })
      );
    } else {
      downloads.push(request.url);
      response.end('release artifact');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const run = promisify(execFile)(
    process.execPath,
    [
      new URL('./forgejo-release.mjs', import.meta.url).pathname,
      'download',
      '--tag',
      'v1.2.3',
      '--pattern',
      pattern,
      '--dir',
      directory,
      ...flags,
    ],
    {
      env: {
        ...process.env,
        FORGEJO_URL: `http://127.0.0.1:${server.address().port}`,
        FORGEJO_TOKEN: 'fixture-token',
      },
    }
  );
  return { directory, downloads, run };
}

test('downloads release assets with standard glob patterns', async (t) => {
  const { directory, downloads, run } = await download(t, 'sable-?.tar.gz');
  await run;
  assert.deepEqual(downloads, ['/sable-1.tar.gz']);
  assert.deepEqual(await readdir(directory), ['sable-1.tar.gz']);
  assert.equal(await readFile(join(directory, 'sable-1.tar.gz'), 'utf8'), 'release artifact');
});

test('a pattern matching no asset fails unless the download is optional', async (t) => {
  const required = await download(t, 'missing-*');
  await assert.rejects(required.run, /No asset of v1\.2\.3 matches missing-\*/);

  const optional = await download(t, 'missing-*', '--optional');
  await optional.run;
  assert.deepEqual(await readdir(optional.directory), []);
});
