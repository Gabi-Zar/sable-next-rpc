import { electronBridge } from './electron';
import { isNativeMobile } from './os';

export async function setUnreadBadge(count: number): Promise<void> {
  const value = count > 0 ? count : null;

  const electron = electronBridge();
  if (electron?.platform === 'linux') {
    await electron.setTrayUnread(value !== null);
    return;
  }

  if (isNativeMobile() || !('setAppBadge' in navigator)) return;
  if (value === null) await navigator.clearAppBadge();
  else await navigator.setAppBadge(value);
}
