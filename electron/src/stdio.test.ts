import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';

import { ignoreBrokenPipes } from './stdio';

function fail(stream: EventEmitter, code: string): void {
  stream.emit('error', Object.assign(new Error(`write ${code}`), { code }));
}

test('a closed pipe is ignored on every stream', () => {
  const streams = [new EventEmitter(), new EventEmitter()];
  ignoreBrokenPipes(streams as never);

  for (const stream of streams)
    expect(() => {
      fail(stream, 'EPIPE');
    }).not.toThrow();
});

test('any other stream error still surfaces', () => {
  const stream = new EventEmitter();
  ignoreBrokenPipes([stream as never]);

  expect(() => {
    fail(stream, 'EIO');
  }).toThrow('write EIO');
});
