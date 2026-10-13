import type { Rpc } from '#src/generated/protocol';

export async function requestOpenIdToken(
  rpc: Rpc
): Promise<{ access_token: string; matrix_server_name: string }> {
  const response = await rpc.session.requestOpenIdToken();
  return {
    access_token: response.access_token,
    matrix_server_name: response.matrix_server_name,
  };
}
