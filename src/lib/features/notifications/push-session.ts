import type { PushFetchView } from '#src/generated/protocol';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { isRecord } from '#lib/guards.js';

import { forgetPushSession, putPushSession } from '#lib/notifications/room-names.js';

type SessionSharer = Pick<CoreClient, 'rpc' | 'session' | 'subscribeEvents'>;

export function sharePushSession(core: SessionSharer): () => void {
  const share = async (): Promise<void> => {
    const session = core.session;
    if (!session) return;
    const { user_id: userId, device_id: deviceId, homeserver } = session;
    try {
      const accessToken = await core.rpc.session.accessToken();
      if (accessToken === null) await forgetPushSession(userId);
      else await putPushSession({ userId, deviceId, homeserver, accessToken });
    } catch (error) {
      console.warn('[sable notifications] sharing push session failed', error);
    }
  };
  void share();
  return core.subscribeEvents((event) => {
    if (event.type === 'session_tokens_refreshed') void share();
  });
}

export async function answerPushEvent(
  core: Pick<CoreClient, 'session' | 'rpc'>,
  request: unknown
): Promise<PushFetchView | null> {
  if (!isRecord(request)) return null;
  const { roomId, eventId, userId } = request;
  if (typeof roomId !== 'string' || typeof eventId !== 'string') return null;
  if (typeof userId === 'string' && userId !== core.session?.user_id) return null;
  return core.rpc.notifications
    .pushEvent({ room_id: roomId, event_id: eventId })
    .catch((error: unknown) => {
      console.debug('[sable notifications] push event unavailable', error);
      return null;
    });
}
