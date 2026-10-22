import { shell } from 'electron';

export function originOf(url: string): string {
  const parsed = URL.parse(url);
  return parsed ? `${parsed.protocol}//${parsed.host}` : '';
}

export function openExternal(url: string): void {
  const parsed = URL.parse(url);
  if (!parsed || !['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) return;
  void shell.openExternal(url).catch((error: unknown) => {
    console.warn('[sable links] Could not open external link', error);
  });
}
