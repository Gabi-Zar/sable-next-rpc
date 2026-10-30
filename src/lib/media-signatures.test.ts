import { expect, test } from 'vitest';

import { imageMime, mediaMime } from './media-signatures.js';

const container = (brand: string) =>
  new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode(`ftyp${brand}`)]);

test.each(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'])(
  'recognizes HEIC brand %s as an image, not MP4 video',
  (brand) => {
    expect(imageMime(container(brand))).toBe('image/heic');
    expect(mediaMime(container(brand))).toBe('image/heic');
  }
);

test.each(['avif', 'avis'])('recognizes AVIF brand %s without routing it through HEIC', (brand) => {
  expect(imageMime(container(brand))).toBe('image/avif');
  expect(mediaMime(container(brand))).toBe('image/avif');
});

test('distinguishes video containers from images', () => {
  expect(mediaMime(container('qt  '))).toBe('video/quicktime');
  expect(mediaMime(container('isom'))).toBe('video/mp4');
  expect(mediaMime(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
  expect(imageMime(container('isom'))).toBeUndefined();
});

test('does not classify truncated headers as containers or PNGs', () => {
  expect(mediaMime(container('heic').subarray(0, 11))).toBeUndefined();
  expect(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
});
