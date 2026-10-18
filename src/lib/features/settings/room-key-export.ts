import type { Rpc } from '#src/generated/protocol';

import { saveBytes } from '#lib/platform/files.js';

export const ROOM_KEYS_EXPORT_NAME = 'sable-keys.txt';

export async function saveRoomKeys(
  encryption: Pick<Rpc['encryption'], 'exportRoomKeys'>,
  passphrase: string,
  roomId?: string,
  name = ROOM_KEYS_EXPORT_NAME
): Promise<Awaited<ReturnType<typeof saveBytes>>> {
  const armored = await encryption.exportRoomKeys({ passphrase, room_id: roomId });
  return saveBytes(new TextEncoder().encode(armored), name, 'text/plain');
}
