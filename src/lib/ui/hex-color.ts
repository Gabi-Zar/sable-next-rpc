export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

export function hexColorOrEmpty(value: string): string {
  const trimmed = value.trim();
  return isHexColor(trimmed) ? trimmed : '';
}
