import { clearNativePushHistory, nativePushHistory } from '#lib/platform/native-notifications.js';

import { type PushHistoryEntry, readPushHistory } from '#lib/notifications/push-history.js';
import { clearPushHistory, pushHistory } from '#lib/notifications/room-names.js';

export async function loadPushHistory(): Promise<PushHistoryEntry[]> {
  const native = await nativePushHistory();
  const entries = native === null ? await pushHistory() : readPushHistory(native);
  return [...entries].reverse();
}

export async function forgetPushHistory(): Promise<void> {
  await Promise.all([clearNativePushHistory(), clearPushHistory()]);
}
