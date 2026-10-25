import { expect, test } from 'vitest';

import { attachmentBytes } from './attachment-bytes';

test('packs files and thumbnails in attachment order', () => {
  const body = attachmentBytes([
    {
      bytes: new Uint8Array([1, 2]),
      thumbnail: { bytes: new Uint8Array([255, 216, 255]), width: 800, height: 450 },
    },
    { bytes: new Uint8Array([3]) },
  ]);
  const header = new DataView(body.buffer);
  expect(header.getBigUint64(0, true)).toBe(2n);
  expect(header.getBigUint64(8, true)).toBe(3n);
  expect(header.getUint32(16, true)).toBe(800);
  expect(header.getUint32(20, true)).toBe(450);
  expect(body.slice(24, 29)).toEqual(new Uint8Array([1, 2, 255, 216, 255]));
  expect(header.getBigUint64(29, true)).toBe(1n);
  expect(body.slice(37, 53)).toEqual(new Uint8Array(16));
  expect(body.slice(53)).toEqual(new Uint8Array([3]));
});
