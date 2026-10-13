import type { RpcError } from '#src/generated/protocol';

export function commandErrorCode(cause: unknown): RpcError['code'] | null {
  if (!(cause instanceof Error) || !('detail' in cause)) return null;
  const detail = (cause as { detail: unknown }).detail;
  if (typeof detail !== 'object' || detail === null || !('code' in detail)) return null;
  return (detail as RpcError).code;
}
