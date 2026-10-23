import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { writeDownload } from './downloads';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'sable-download-'));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test.each([
  '',
  '.',
  '..',
  '../outside.txt',
  '..\\outside.txt',
  '/tmp/outside.txt',
  'C:\\outside.txt',
  '\\\\server\\share\\file',
  'file.txt:stream',
  'bad\0name',
  'name\n.txt',
  'trailing.',
  'trailing ',
  'CON',
  'nul.txt',
  'COM1.log',
])('rejects unsafe download filename %j without writing', async (name) => {
  await expect(writeDownload(directory, name, new Uint8Array([1]))).rejects.toThrow(
    'Invalid download filename'
  );
  expect(await readdir(directory)).toEqual([]);
});

test('saves a file in Downloads without overwriting an existing file', async () => {
  const original = join(directory, 'report.txt');
  await writeFile(original, 'original');
  const saved = await writeDownload(directory, 'report.txt', new TextEncoder().encode('new'));
  expect(saved).not.toBe(original);
  expect(await readFile(original, 'utf8')).toBe('original');
  expect(await readFile(saved, 'utf8')).toBe('new');
  expect(await readdir(directory)).toHaveLength(2);
});

test('accepts Unicode and filenames with multiple dots', async () => {
  const saved = await writeDownload(directory, 'résumé.final.txt', new Uint8Array([1, 2]));
  expect(saved).toBe(join(directory, 'résumé.final.txt'));
  expect(await readFile(saved)).toEqual(Buffer.from([1, 2]));
});
