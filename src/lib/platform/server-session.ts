import { boundServerIdentity, clearServerPushSessions } from '#lib/notifications/room-names.js';
import { clearServerNotifications } from './server-notification-owner.js';

export async function signOutServer(): Promise<void> {
  const identity = boundServerIdentity();
  if (!identity) throw new Error('Server identity unavailable');
  const base = new URL(import.meta.env.VITE_SABLE_SERVER_URL ?? '/', window.location.href);
  const response = await fetch(new URL('/_sable/logout', base), {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-sable-user': identity },
  });
  if (!response.ok) throw new Error('Server sign out failed');
  await Promise.all([
    clearServerNotifications(),
    clearServerPushSessions(identity).catch((error: unknown) => {
      console.debug('[sable notifications] could not clear push credentials', error);
    }),
  ]);
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('sable-server-identity');
    channel.postMessage('logout');
    channel.close();
  }
  window.location.reload();
}
