import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { expect, test } from 'vitest';

import { captureCorePanic, ignoreBrokenPipes } from './stdio';

function fail(stream: EventEmitter, code: string): void {
  stream.emit('error', Object.assign(new Error(`write ${code}`), { code }));
}

test.each(['EPIPE', 'EIO'])('a closed output (%s) is ignored on every stream', (code) => {
  const streams = [new EventEmitter(), new EventEmitter()];
  ignoreBrokenPipes(streams as never);

  for (const stream of streams)
    expect(() => {
      fail(stream, code);
    }).not.toThrow();
});

test('any other stream error still surfaces', () => {
  const stream = new EventEmitter();
  ignoreBrokenPipes([stream as never]);

  expect(() => {
    fail(stream, 'ENOSPC');
  }).toThrow('write ENOSPC');
});

const PANIC_MARKER = 'SABLE_CORE_PANIC ';

test.each(['é', '🙂'])(
  'a panic keeps %s intact across UTF-8 chunks and forwards the original bytes',
  async (character) => {
    const stderr = new PassThrough();
    const chunks: Buffer[] = [];
    stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    const panic = captureCorePanic(stderr);
    const bytes = Buffer.from(`log line\n${PANIC_MARKER}café 🙂\n`);
    const split = bytes.indexOf(Buffer.from(character)) + 1;
    stderr.write(bytes.subarray(0, split));
    stderr.end(bytes.subarray(split));
    expect(await panic).toBe('café 🙂');
    expect(Buffer.concat(chunks)).toEqual(bytes);
  }
);

test('the first panic is retained and a final line without a newline is flushed', async () => {
  const stderr = new PassThrough();
  const panic = captureCorePanic(stderr);
  stderr.write('ordinary output\nSABLE_CORE_');
  stderr.end('PANIC final panic');
  expect(await panic).toBe('final panic');

  const repeated = new PassThrough();
  const first = captureCorePanic(repeated);
  repeated.end(`${PANIC_MARKER}first\n${PANIC_MARKER}second\n`);
  expect(await first).toBe('first');
});

test('a missing, clean or closed stderr stream has no panic', async () => {
  expect(await captureCorePanic(null)).toBeUndefined();
  const stderr = new PassThrough();
  const panic = captureCorePanic(stderr);
  stderr.end('normal output\n');
  expect(await panic).toBeUndefined();
  const broken = new PassThrough();
  const failed = captureCorePanic(broken);
  broken.destroy();
  expect(await failed).toBeUndefined();
});

test('a broken stderr pipe reports its read error', async () => {
  const stderr = new PassThrough();
  const failed = captureCorePanic(stderr);
  stderr.destroy(new Error('closed pipe'));
  await expect(failed).rejects.toThrow('closed pipe');
});
