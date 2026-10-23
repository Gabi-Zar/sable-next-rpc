import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const NATIVE_SOURCES = new Set([
  'ipc:',
  'http://ipc.localhost',
  'sable-tiles:',
  'http://sable-tiles.localhost',
]);

/** @param {Record<string, string>} directives */
export function browserCsp(directives) {
  return Object.fromEntries(
    Object.entries(directives).map(([name, sources]) => [
      name,
      sources
        .split(/\s+/)
        .filter((source) => !NATIVE_SOURCES.has(source))
        .join(' '),
    ])
  );
}

/** @param {string} html */
export function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    ([, body]) => body
  );
}

/** @param {Record<string, string>} directives @param {string[]} scripts */
export function cspHeader(directives, scripts = []) {
  const hashes = [...new Set(scripts)].map(
    (script) => `'sha256-${createHash('sha256').update(script).digest('base64')}'`
  );
  return Object.entries(directives)
    .map(
      ([name, sources]) =>
        `${name} ${name === 'script-src' ? [sources, ...hashes].join(' ') : sources}`
    )
    .join('; ');
}

/** @param {string} directory @param {Record<string, string>} directives */
export async function writeCspHeaders(directory, directives) {
  const pages = (await readdir(directory, { recursive: true }))
    .filter((file) => file.endsWith('.html'))
    .sort();
  const scripts = (
    await Promise.all(
      pages.map(async (file) => inlineScripts(await readFile(join(directory, file), 'utf8')))
    )
  ).flat();
  const header = cspHeader(browserCsp(directives), scripts);
  if (Buffer.byteLength(`  Content-Security-Policy: ${header}`) > 2000) {
    throw new Error('CSP header line exceeds 2000 bytes');
  }
  const cacheHeaders = await readFile('static/_headers', 'utf8');
  await writeFile(
    join(directory, '_headers'),
    `/*\n  Content-Security-Policy: ${header}\n\n${cacheHeaders}`
  );
  await writeFile(join(directory, 'csp.caddy'), `header Content-Security-Policy "${header}"\n`);
}
