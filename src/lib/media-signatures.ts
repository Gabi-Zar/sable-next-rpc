const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function containerBrand(bytes: Uint8Array): string | undefined {
  return bytes.length >= 12 && startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)
    ? String.fromCharCode(...bytes.subarray(8, 12))
    : undefined;
}

export function imageMime(bytes: Uint8Array): string | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46])) return 'image/gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  const brand = containerBrand(bytes);
  if (brand === 'avif' || brand === 'avis') return 'image/avif';
  if (brand && HEIC_BRANDS.has(brand)) return 'image/heic';
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
    ? 'image/svg+xml'
    : undefined;
}

export function mediaMime(bytes: Uint8Array): string | undefined {
  const image = imageMime(bytes);
  if (image) return image;
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  const brand = containerBrand(bytes);
  return brand === undefined ? undefined : brand === 'qt  ' ? 'video/quicktime' : 'video/mp4';
}
