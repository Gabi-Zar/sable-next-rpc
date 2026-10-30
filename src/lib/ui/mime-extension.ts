import { appMime } from '#lib/mime.js';

export function mimeExtension(type: string | null, filename = ''): string | null {
  if (!type) return null;
  const normalized = type.split(';')[0].trim().toLowerCase();
  const extensions = appMime.getAllExtensions(normalized);
  const dot = filename.lastIndexOf('.');
  const existing = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  if (existing && extensions?.has(existing)) return existing;
  return appMime.getExtension(normalized);
}
