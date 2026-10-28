const OWNER_KEY = 'sable-server-notification-owner';

export async function clearServerNotifications(): Promise<void> {
  try {
    const registration =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const notifications = await registration?.getNotifications();
    for (const notification of notifications ?? []) notification.close();
  } catch (error) {
    console.debug('[sable notifications] could not clear old notifications', error);
  }
}

export async function bindServerNotificationOwner(
  identity: string,
  clearPrevious: (previous: string) => Promise<void>
): Promise<void> {
  let previous: string | null;
  try {
    previous = localStorage.getItem(OWNER_KEY);
  } catch {
    await clearServerNotifications();
    return;
  }
  if (previous !== identity) {
    await clearServerNotifications();
    if (previous && /^(legacy|[0-9a-f-]{36})$/.test(previous)) await clearPrevious(previous);
  }
  try {
    localStorage.setItem(OWNER_KEY, identity);
  } catch {
    await clearServerNotifications();
  }
}
