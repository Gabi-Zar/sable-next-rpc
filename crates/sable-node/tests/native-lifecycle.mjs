import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isMainThread, Worker, workerData } from 'node:worker_threads';

const filename = fileURLToPath(import.meta.url);

if (!isMainThread) {
  const { SableCore } = createRequire(import.meta.url)(workerData.addon);
  const core = new SableCore(workerData.directory, 'off');
  const restored = core.call('session.restore', '{}');
  assert.ok(restored instanceof Promise);
  restored.then((value) => {
    assert.equal(value, 'null');
    void core.call(
      'auth.login_flows',
      JSON.stringify({ homeserver: `http://127.0.0.1:${workerData.port}` })
    );
  });
} else if (process.argv[2] === '--fixture') {
  const directory = mkdtempSync(join(tmpdir(), 'sable-native-lifecycle-'));
  let worker;
  const server = createServer(() => {
    void worker.terminate().then((code) => {
      assert.equal(code, 1);
      server.closeAllConnections();
      server.close();
    });
  });
  server.listen(0, '127.0.0.1', () => {
    worker = new Worker(filename, {
      workerData: {
        addon: process.argv[3],
        directory,
        port: server.address().port,
      },
    });
    worker.on('error', (error) => {
      throw error;
    });
  });
  process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
} else {
  test(
    'terminating an environment with a pending native call does not abort the process',
    { skip: !process.env.SABLE_NODE_ADDON },
    () => {
      const result = spawnSync(
        process.execPath,
        [filename, '--fixture', process.env.SABLE_NODE_ADDON],
        { encoding: 'utf8', timeout: 15000 }
      );
      assert.ifError(result.error);
      assert.equal(result.signal, null, result.stderr);
      assert.equal(result.status, 0, result.stderr);
    }
  );
}
