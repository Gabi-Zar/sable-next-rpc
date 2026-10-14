import {
  dismissNativeReadRoomNotifications,
  dismissNativeRoomNotifications,
} from '#lib/platform/native-notifications.js';

import { roomTag } from './tag';

export async function retireRoomAlerts(userId: string, roomIds: readonly string[]): Promise<void> {
  if (roomIds.length === 0) return;

  await Promise.all([
    dismissNativeRoomNotifications(userId, roomIds),
    closePresented(new Set(roomIds.map((roomId) => roomTag(userId, roomId)))),
  ]);
}

export async function retireReadAlerts(userId: string, roomIds: readonly string[]): Promise<void> {
  if (roomIds.length === 0) return;

  await Promise.all([
    dismissNativeReadRoomNotifications(userId, roomIds),
    closePresented(new Set(roomIds.map((roomId) => roomTag(userId, roomId)))),
  ]);
}

async function closePresented(tags: ReadonlySet<string>): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const registration = await navigator.serviceWorker.getRegistration().catch((error: unknown) => {
    console.debug('[sable notifications] service worker registration unavailable', error);
    return undefined;
  });
  if (registration === undefined || !('getNotifications' in registration)) return;

  for (const notification of await registration.getNotifications()) {
    if (tags.has(notification.tag)) notification.close();
  }
}
