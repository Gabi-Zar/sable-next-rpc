import { expect, test } from 'vitest';

import { mimeExtension } from './mime-extension.js';

test.each([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpeg'],
  ['image/svg+xml', 'svg+xml'],
  ['text/plain; charset=utf-8', 'plain'],
  ['audio/mpeg', 'mpeg'],
  ['video/quicktime', 'mov'],
  ['video/x-matroska', 'mkv'],
])('extracts %s as %s', (mime, expected) => {
  expect(mimeExtension(mime)).toBe(expected);
});

test.each([null, '', 'no-slash-here'])('returns null for %s', (mime) => {
  expect(mimeExtension(mime)).toBeNull();
});

test('prefers the file name extension for a vendor subtype', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  expect(mimeExtension(docx, 'test-file.DOCX')).toBe('docx');
  expect(mimeExtension(docx, 'test-file')).toBe(docx.slice(docx.indexOf('/') + 1));
});
