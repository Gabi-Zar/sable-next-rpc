import type { GalleryAttachment } from './index';

export function attachmentBytes(
  attachments: readonly Pick<GalleryAttachment, 'bytes' | 'thumbnail'>[]
): Uint8Array<ArrayBuffer> {
  const size = attachments.reduce(
    (total, { bytes, thumbnail }) =>
      total + 24 + bytes.byteLength + (thumbnail?.bytes.byteLength ?? 0),
    0
  );
  const body = new Uint8Array(size);
  const header = new DataView(body.buffer);
  let offset = 0;
  for (const { bytes, thumbnail } of attachments) {
    header.setBigUint64(offset, BigInt(bytes.byteLength), true);
    header.setBigUint64(offset + 8, BigInt(thumbnail?.bytes.byteLength ?? 0), true);
    header.setUint32(offset + 16, thumbnail?.width ?? 0, true);
    header.setUint32(offset + 20, thumbnail?.height ?? 0, true);
    offset += 24;
    body.set(bytes, offset);
    offset += bytes.byteLength;
    if (thumbnail) {
      body.set(thumbnail.bytes, offset);
      offset += thumbnail.bytes.byteLength;
    }
  }
  return body;
}
