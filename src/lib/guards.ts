export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUserId(value: string): boolean {
  return /^@[^:\s]+:\S+$/.test(value);
}
