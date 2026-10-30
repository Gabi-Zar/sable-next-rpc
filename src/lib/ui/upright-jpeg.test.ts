import { afterEach, expect, test, vi } from 'vitest';

import { jpegOrientation, uprightJpeg } from './upright-jpeg.js';

function jpegWithOrientation(orientation: number, little: boolean): Uint8Array<ArrayBuffer> {
  const tiff = new DataView(new ArrayBuffer(26));
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, little);
  tiff.setUint32(4, 8, little);
  tiff.setUint16(8, 1, little);
  tiff.setUint16(10, 0x0112, little);
  tiff.setUint16(12, 3, little);
  tiff.setUint32(14, 1, little);
  tiff.setUint16(18, orientation, little);

  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...new Uint8Array(tiff.buffer)];
  const length = exif.length + 2;
  return new Uint8Array([
    0xff,
    0xd8,
    ...app0,
    0xff,
    0xe1,
    length >> 8,
    length & 0xff,
    ...exif,
    0xff,
    0xda,
  ]);
}

afterEach(() => vi.unstubAllGlobals());

test.each([1, 2, 3, 4, 5, 6, 7, 8])(
  'reads orientation %i from either EXIF byte order',
  async (value) => {
    expect(await jpegOrientation(jpegWithOrientation(value, false))).toBe(value);
    expect(await jpegOrientation(jpegWithOrientation(value, true))).toBe(value);
  }
);

test('treats a jpeg without EXIF, a non-jpeg and a truncated file as upright', async () => {
  expect(await jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBe(1);
  expect(await jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
  expect(await jpegOrientation(jpegWithOrientation(6, false).slice(0, 20))).toBe(1);
});

test('reads a view without consuming bytes outside it', async () => {
  const jpeg = jpegWithOrientation(6, true);
  const storage = new Uint8Array(jpeg.length + 8);
  storage.set(jpeg, 4);
  expect(await jpegOrientation(storage.subarray(4, 4 + jpeg.length))).toBe(6);
});

test('leaves a non-jpeg and an upright jpeg untouched', async () => {
  const png = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' });
  const upright = new Blob([jpegWithOrientation(1, false)], { type: 'image/jpeg' });
  expect(await uprightJpeg(png)).toBe(png);
  expect(await uprightJpeg(upright)).toBe(upright);
});

test('re-encodes an oriented jpeg using the browser bitmap and closes it', async () => {
  const file = new Blob([jpegWithOrientation(6, false)], { type: 'image/jpeg' });
  const upright = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
  const bitmap = { width: 60, height: 90, close: vi.fn() };
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (callback: BlobCallback) => {
      callback(upright);
    },
  };
  const createBitmap = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.stubGlobal('document', { createElement: () => canvas });

  expect(await uprightJpeg(file)).toBe(upright);
  expect(createBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  expect([canvas.width, canvas.height]).toEqual([60, 90]);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(await jpegOrientation(new Uint8Array(await upright.arrayBuffer()))).toBe(1);
});
