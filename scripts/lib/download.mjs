import { createHash } from 'node:crypto';

/** @param {Buffer} bytes */
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @param {string} url
 * @param {string} expected
 */
export async function downloadVerified(url, expected) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== expected) {
    throw new Error(`checksum mismatch for ${url}: expected ${expected}, got ${digest}`);
  }
  return bytes;
}
