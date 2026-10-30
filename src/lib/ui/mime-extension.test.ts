import { expect, test } from 'vitest';

import { mimeExtension } from './mime-extension.js';

test.each([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/svg+xml', 'svg'],
  ['text/plain; charset=utf-8', 'txt'],
  ['audio/mpeg', 'mp3'],
  ['video/quicktime', 'mov'],
  ['audio/aac', 'aac'],
  ['audio/opus', 'opus'],
  ['video/x-matroska', 'mkv'],
])('extracts %s as %s', (mime, expected) => {
  expect(mimeExtension(mime)).toBe(expected);
});

test.each([null, '', 'no-slash-here'])('returns null for %s', (mime) => {
  expect(mimeExtension(mime)).toBeNull();
});

test('preserves an existing extension that matches the MIME type', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  expect(mimeExtension(docx, 'test-file.DOCX')).toBe('docx');
  expect(mimeExtension(docx, 'test-file')).toBe('docx');
  expect(mimeExtension('image/jpeg', 'photo.jpg')).toBe('jpg');
  expect(mimeExtension('text/plain', 'notes.exe')).toBe('txt');
});

test('unknown MIME types do not invent extensions', () => {
  expect(mimeExtension('application/vnd.sable.unknown', 'file.unknown')).toBeNull();
});
