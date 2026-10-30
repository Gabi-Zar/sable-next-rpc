import type { BrowserContext, Page, Worker } from '@playwright/test';
import { expect, test, SIGNED_OUT } from './fixtures/test';

// The headless shell has no notification platform and crashes on
// showNotification; Chrome's own headless mode has one.
test.use({ channel: 'chromium', storageState: SIGNED_OUT });

test.beforeEach(async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
});

// Headless Chrome reports every open page as focused, and the worker shows
// nothing while a window is focused. The app page is closed before a push, so
// the worker is read through its own registration instead of a page.
function pushWorker(context: BrowserContext): Worker {
  const worker = context.serviceWorkers().at(0);
  if (!worker) throw new Error('the service worker is not running');
  return worker;
}

async function shownNotifications(context: BrowserContext): Promise<string[]> {
  return pushWorker(context).evaluate(async () => {
    const worker = self as unknown as ServiceWorkerGlobalScope;
    const notifications = await worker.registration.getNotifications();
    return notifications.map((notification) => {
      const shown = `${notification.title}|${notification.body}|${notification.tag}`;
      notification.close();
      return shown;
    });
  });
}

async function shownActions(context: BrowserContext): Promise<string[][]> {
  return pushWorker(context).evaluate(async () => {
    const worker = self as unknown as ServiceWorkerGlobalScope;
    const notifications = await worker.registration.getNotifications();
    return notifications.map((notification) => {
      const titles = (notification as Notification & { actions: { title: string }[] }).actions.map(
        (action) => action.title
      );
      notification.close();
      return titles;
    });
  });
}

async function openNotificationCount(context: BrowserContext): Promise<number> {
  return pushWorker(context).evaluate(async () => {
    const worker = self as unknown as ServiceWorkerGlobalScope;
    return (await worker.registration.getNotifications()).length;
  });
}

async function cachedNotificationValue<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(
    (id) =>
      new Promise<T | undefined>((resolve, reject) => {
        const open = indexedDB.open('sable-notifications', 1);
        open.onerror = () => {
          reject(open.error ?? new Error('notification cache unavailable'));
        };
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains('room-names')) {
            database.close();
            resolve(undefined);
            return;
          }
          const request = database.transaction('room-names').objectStore('room-names').get(id);
          request.onsuccess = () => {
            database.close();
            resolve(request.result as T | undefined);
          };
          request.onerror = () => {
            database.close();
            reject(request.error ?? new Error('notification cache unavailable'));
          };
        };
      }),
    key
  );
}

/** Attaches to the activated worker from a spare page, then closes the app page. */
async function leaveApp(context: BrowserContext, page: Page) {
  const spare = await context.newPage();
  const session = await context.newCDPSession(spare);
  const activated = new Promise<string>((resolve) => {
    session.on('ServiceWorker.workerVersionUpdated', (event) => {
      const running = event.versions.find((version) => version.status === 'activated');
      if (running) resolve(running.registrationId);
    });
  });
  await session.send('ServiceWorker.enable');
  const registrationId = await activated;
  await page.close();
  return (data: string) =>
    session.send('ServiceWorker.deliverPushMessage', {
      origin: 'http://127.0.0.1',
      registrationId,
      data,
    });
}

test('a push shows a notification naming the room the app cached', async ({
  page,
  app,
  context,
  freshLogin,
}) => {
  await context.grantPermissions(['notifications']);
  const admin = await freshLogin();

  const roomName = `Pushed ${String(Date.now())}`;
  const roomId = await admin.createRoom({ name: roomName });
  const eventId = await admin.sendMessage(roomId, 'A message worth pushing.');

  await app.openRooms();
  await expect(app.roomLink(roomName)).toBeVisible({ timeout: 30_000 });
  // The worker names the room from what the app wrote; a push before that says "Sable".
  await expect
    .poll(() => cachedNotificationValue<string>(page, roomId), { timeout: 30_000 })
    .toBe(roomName);
  const deliver = await leaveApp(context, page);

  const payload = JSON.stringify({
    notification: {
      room_id: roomId,
      event_id: eventId,
      user_id: admin.userId,
      counts: { unread: 3 },
    },
  });

  await expect
    .poll(
      async () => {
        await deliver(payload);
        return (await shownNotifications(context)).map((shown) => {
          const [title, , tag] = shown.split('|');
          return `${title}|${tag}`;
        });
      },
      { timeout: 60_000 }
    )
    .toEqual([`${roomName}|${admin.userId} ${roomId}:${eventId}`]);
});

test('a push for an invitation reads as an invitation with accept and decline', async ({
  page,
  app,
  context,
  freshLogin,
  guest,
}) => {
  await context.grantPermissions(['notifications']);
  const admin = await freshLogin();

  const roomName = `Invited ${String(Date.now())}`;
  const roomId = await guest.createRoom({ name: roomName, invite: [admin.userId] });

  await app.openRooms();
  const deliver = await leaveApp(context, page);

  const payload = JSON.stringify({
    notification: {
      room_id: roomId,
      event_id: '$an-invite',
      user_id: admin.userId,
      type: 'm.room.member',
      membership: 'invite',
      sender_display_name: 'Ada',
      counts: { unread: 1 },
    },
  });

  await expect
    .poll(
      async () => {
        await deliver(payload);
        const bodies = await pushWorker(context).evaluate(async () => {
          const worker = self as unknown as ServiceWorkerGlobalScope;
          return (await worker.registration.getNotifications()).map(
            (notification) => notification.body
          );
        });
        return bodies;
      },
      { timeout: 60_000 }
    )
    .toEqual([expect.stringMatching(/invited you/i)]);
  expect(await shownActions(context)).toEqual([['Accept', 'Decline']]);
});

test('a push saying everything is read closes the notification it had shown', async ({
  page,
  app,
  context,
  freshLogin,
}) => {
  await context.grantPermissions(['notifications']);
  const admin = await freshLogin();

  const roomName = `Read ${String(Date.now())}`;
  const roomId = await admin.createRoom({ name: roomName });
  const eventId = await admin.sendMessage(roomId, 'A message read elsewhere.');

  await app.openRooms();
  await expect(app.roomLink(roomName)).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        (await cachedNotificationValue<{ clearOnRead: boolean }>(page, '\u0000push-content-policy'))
          ?.clearOnRead,
      { timeout: 30_000 }
    )
    .toBe(true);
  const deliver = await leaveApp(context, page);

  const push = (unread: number) =>
    deliver(
      JSON.stringify({
        notification: {
          room_id: roomId,
          event_id: eventId,
          user_id: admin.userId,
          counts: { unread },
        },
      })
    );

  await push(3);
  await expect.poll(() => openNotificationCount(context), { timeout: 60_000 }).toBe(1);

  await push(0);
  await expect.poll(() => openNotificationCount(context), { timeout: 30_000 }).toBe(0);
});
