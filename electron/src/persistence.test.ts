import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { flushWrites, flushWritesBeforeQuit, writeJson } from './persistence';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sable-persistence-'));
});

afterEach(async () => {
  await flushWrites();
  await rm(directory, { recursive: true, force: true });
});

test('concurrent settings writes finish in call order and leave complete JSON', async () => {
  const path = join(directory, 'settings.json');
  const payload = 'settings'.repeat(32_768);
  const writes = Array.from({ length: 8 }, (_, version) => writeJson(path, { version, payload }));
  await Promise.all(writes);
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 7, payload });
  expect(await readdir(directory)).toEqual(['settings.json']);
});

test('quit waits for queued writes, including updates made while it is waiting', async () => {
  const path = join(directory, 'settings.json');
  const first = writeJson(path, { hardwareAcceleration: true });
  const event = { preventDefault: vi.fn() };
  const quit = vi.fn();
  flushWritesBeforeQuit(event, quit);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(quit).not.toHaveBeenCalled();
  const last = writeJson(path, { hardwareAcceleration: false });
  flushWritesBeforeQuit(event, quit);
  await Promise.all([first, last]);
  await vi.waitFor(() => {
    expect(quit).toHaveBeenCalledOnce();
  });
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ hardwareAcceleration: false });
  const next = { preventDefault: vi.fn() };
  flushWritesBeforeQuit(next, quit);
  expect(next.preventDefault).not.toHaveBeenCalled();
});

test('failed writes reject their callers and do not leave quit waiting', async () => {
  const write = writeJson(join(directory, 'missing', 'settings.json'), {});
  const failed = expect(write).rejects.toMatchObject({ code: 'ENOENT' });
  const event = { preventDefault: vi.fn() };
  const quit = vi.fn();
  flushWritesBeforeQuit(event, quit);
  await failed;
  await vi.waitFor(() => {
    expect(quit).toHaveBeenCalledOnce();
  });
});
