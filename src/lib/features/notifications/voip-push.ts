import type { CoreClient } from '#lib/core/client.svelte.js';

const REGISTERED_KEY = 'sable.push.voip';

interface Registered {
  userId: string;
  appId: string;
  pushkey: string;
}

function registered(): Registered | null {
  try {
    const value = JSON.parse(localStorage.getItem(REGISTERED_KEY) ?? 'null') as Registered | null;
    return value && typeof value.pushkey === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function unregisterVoipPusher(core: CoreClient): Promise<void> {
  const previous = registered();
  if (!previous || previous.userId !== core.session?.user_id) return;
  try {
    await core.rpc.push.removePusher({ pushkey: previous.pushkey, app_id: previous.appId });
    localStorage.removeItem(REGISTERED_KEY);
  } catch (error) {
    console.debug('[sable notifications] removing VoIP pusher failed', error);
  }
}
