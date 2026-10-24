/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { version } from '$app/env';
import { resolve } from '$app/paths';

import favicon from '#lib/assets/favicon.png';
import { alertCooling } from '#lib/features/notifications/alert-cooldown.js';
import { notificationPermalink } from '#lib/features/notifications/notification-link.js';
import {
  activeElsewhere,
  parsePushPayload,
  pushAlert,
  type PushNotification,
  silencedByRoomMode,
  type WebPushValidation,
  webPushValidation,
} from '#lib/notifications/push-payload.js';
import {
  acknowledgeWebPusher,
  completePushPayload,
  fetchOwnPresence,
  namesOnlyItsEvent,
  readPushFetch,
} from '#lib/features/notifications/push-fetch.js';
import {
  isDiagnosticPush,
  pushTrace,
  type PushHistoryEntry,
} from '#lib/notifications/push-history.js';
import {
  activeAt,
  pushContentPolicy,
  pendingPushActivations,
  pushSession,
  recordPush,
  roomMode,
  roomName,
  settlePushActivation,
} from '#lib/notifications/room-names.js';
import { loadModel } from '#lib/model/model.js';
import modelWasm from '#src/generated/wasm/sable_model_bg.wasm?url';
import type { PushFetchView } from '#src/generated/protocol';
import { reportWorkerError, watchWorkerOperation } from './telemetry.js';

const worker = globalThis.self as unknown as ServiceWorkerGlobalScope;

// A worker from an older deploy must not depend on assets the next deploy removed.
const MODEL_CACHE = `sable-model-${version}`;

worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(MODEL_CACHE).then((cache) => cache.add(modelWasm)));
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('sable-model-') && name !== MODEL_CACHE)
            .map((name) => caches.delete(name))
        )
      )
  );
});

async function cachedModel(): Promise<Response> {
  return (await caches.match(modelWasm, { cacheName: MODEL_CACHE })) ?? fetch(modelWasm);
}

worker.addEventListener('error', (event) => {
  void reportWorkerError('error', event.error ?? new Error(event.message)).catch(
    (error: unknown) => {
      console.debug('[sable service-worker] error not reported', error);
    }
  );
});
worker.addEventListener('unhandledrejection', (event) => {
  void reportWorkerError('unhandledrejection', event.reason).catch((error: unknown) => {
    console.debug('[sable service-worker] rejection not reported', error);
  });
});

worker.addEventListener('push', (event) => {
  const raw = event.data?.text();
  event.waitUntil(
    watchWorkerOperation(
      'push',
      loadModel(cachedModel()).then(() => receive(raw))
    ).catch(showFallback)
  );
});

/** Safari revokes the subscription of a push that shows nothing. */
async function showFallback(): Promise<void> {
  await record('FALLBACK_SHOWN');
  await worker.registration.showNotification('Sable', {
    body: 'New message',
    tag: 'sable-fallback',
    icon: favicon,
    badge: favicon,
  });
}

async function receive(raw: string | undefined): Promise<void> {
  const validation = webPushValidation(raw);
  if (validation) {
    await watchWorkerOperation('push-validation', acknowledge(validation));
    return;
  }
  await present(parsePushPayload(raw) ?? undefined);
}

async function acknowledge(validation: WebPushValidation): Promise<void> {
  const [, pending] = await Promise.all([
    record('WEBPUSH_VALIDATION'),
    pendingPushActivations(Date.now()),
  ]);
  const acked = await Promise.all(pending.map((userId) => acknowledgeFor(userId, validation)));
  if (acked.includes(true)) return;

  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type: 'sable:webpush-ack',
      appId: validation.app_id,
      ackToken: validation.ack_token,
    });
  }
}

async function acknowledgeFor(userId: string, validation: WebPushValidation): Promise<boolean> {
  const session = await pushSession(userId);
  if (!session) return false;
  const acked = await acknowledgeWebPusher(session, validation, (input, init) =>
    fetch(input, init)
  );
  if (acked) await settlePushActivation(userId);
  return acked;
}

worker.addEventListener('message', (event) => {
  const message = event.data as { type?: unknown } | undefined;
  if (message?.type === 'sable:skip-waiting')
    event.waitUntil(watchWorkerOperation('skip-waiting', worker.skipWaiting()));
  if (message?.type === 'sable:share-take')
    event.waitUntil(watchWorkerOperation('share-take', handShares()));
  if (message?.type === 'sable:version') event.ports[0]?.postMessage(version);
});

interface StashedShare {
  text: string;
  files: File[];
}

const shareAction = `${resolve('/(app)').replace(/\/$/, '')}/share`;
const shares = new Map<string, StashedShare>();

worker.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== shareAction) return;
  event.respondWith(watchWorkerOperation('share', stashShare(event)));
});

const SHARE_HOLD_MS = 15_000;

async function stashShare(event: FetchEvent): Promise<Response> {
  const form = await event.request.formData();
  const text = ['title', 'text', 'url']
    .map((field) => form.get(field))
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join('\n');
  const files = form.getAll('files').filter((value): value is File => value instanceof File);

  const id = crypto.randomUUID();
  shares.set(id, { text, files });
  event.waitUntil(watchWorkerOperation('share-hold', holdShare(id)));

  return Response.redirect(resolve('/(app)'), 303);
}

async function holdShare(id: string): Promise<void> {
  const deadline = Date.now() + SHARE_HOLD_MS;
  while (shares.has(id) && Date.now() < deadline) {
    await handShares();
    if (!shares.has(id)) return;
    await new Promise((settle) => setTimeout(settle, 250));
  }
  shares.delete(id);
}

async function handShares(): Promise<void> {
  if (shares.size === 0) return;

  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = clients.at(0);
  if (!client) return;

  for (const [id, share] of shares) {
    shares.delete(id);
    client.postMessage({ type: 'sable:share', text: share.text, files: share.files });
  }
}

function record(outcome: string, trace: Omit<PushHistoryEntry, 'at' | 'outcome'> = {}) {
  return recordPush({ at: Date.now(), outcome, ...trace });
}

async function present(pushed: PushNotification | undefined): Promise<void> {
  if (!pushed) {
    await record('INVALID_PAYLOAD');
    return;
  }
  const trace = pushTrace(pushed);
  if (isDiagnosticPush(pushed)) {
    await record('DIAGNOSTIC_RECEIVED', trace);
    return;
  }

  if (pushed.unread !== null && 'setAppBadge' in navigator) {
    await navigator.setAppBadge(pushed.unread).catch((error: unknown) => {
      console.debug('[sable service-worker] app badge not set', error);
    });
  }
  if (pushed.unread === 0 && (await pushContentPolicy()).clearOnRead) {
    await closeRead(pushed);
    await record('READ_DISMISSED', trace);
    return;
  }

  if (await focused()) {
    await record('APP_FOCUSED', trace);
    return;
  }
  const fetched = namesOnlyItsEvent(pushed);
  const payload = fetched ? await fetchEvent(pushed) : pushed;
  if (!payload) {
    await record('DISCARDED', trace);
    return;
  }
  if (fetched) await record(payload.type ? 'FETCHED' : 'FETCH_FAILED', trace);
  if (silencedByRoomMode(payload, await roomMode(payload.room_id ?? ''))) {
    await record('ROOM_MODE_SILENCED', trace);
    return;
  }

  const policy = await pushContentPolicy();
  const encrypted = payload.type === 'm.room.encrypted' || payload.decrypted;
  const showContent = policy.content && (!encrypted || policy.encryptedContent);
  const showing = pushAlert(payload, await roomName(payload.room_id ?? ''), showContent);
  if (!showing) {
    await record('BADGE_ONLY', trace);
    return;
  }
  if (
    policy.quietWhenActiveElsewhere &&
    !showing.ring &&
    !showing.invite &&
    (await inUseElsewhere(payload.user_id ?? undefined))
  ) {
    await record('ACTIVE_ELSEWHERE', trace);
    return;
  }

  const alertedAt = await alertedAtFor(showing.room_id, payload.user_id ?? undefined);
  const now = Date.now();
  const renotify =
    !policy.notifyOnce || alertedAt === undefined || payload.noisy || !alertCooling(alertedAt, now);
  const tag = showing.event_id === null ? showing.tag : `${showing.tag}:${showing.event_id}`;

  const options: NotificationOptions & {
    renotify?: boolean;
    timestamp?: number;
    actions?: { action: string; title: string }[];
  } = {
    body: showing.body,
    tag,
    renotify,
    silent: !renotify,
    icon: payload.icon ?? favicon,
    badge: favicon,
    timestamp: now,
    data: {
      roomId: showing.room_id,
      userId: payload.user_id ?? undefined,
      eventId: showing.event_id,
      invite: showing.invite,
      alertedAt: renotify ? now : alertedAt,
    },
  };
  if (showing.ring) {
    options.actions = [
      { action: 'answer', title: 'Answer' },
      { action: 'decline', title: 'Decline' },
    ];
    options.requireInteraction = true;
  }
  if (showing.invite) {
    options.actions = [
      { action: 'accept', title: 'Accept' },
      { action: 'decline', title: 'Decline' },
    ];
  }

  await worker.registration.showNotification(showing.title, options);
  await record('POSTED', trace);
}

async function inUseElsewhere(userId: string | undefined): Promise<boolean> {
  const session = await pushSession(userId);
  if (!session) return false;
  const [presence, usedAt] = await Promise.all([
    fetchOwnPresence({ session, fetch: (input, init) => fetch(input, init) }),
    activeAt(),
  ]);
  return (
    presence !== null && activeElsewhere(presence, usedAt === null ? null : Date.now() - usedAt)
  );
}

const FETCH_DEADLINE_MS = 10_000;

async function fetchEvent(payload: PushNotification): Promise<PushNotification | null> {
  const session = await pushSession(payload.user_id ?? undefined);
  if (!session) return payload;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<PushNotification>((settle) => {
    timer = setTimeout(() => {
      settle(payload);
    }, FETCH_DEADLINE_MS);
  });
  const completed = completePushPayload(
    { ...payload, user_id: session.userId },
    {
      session,
      fetch: (input, init) => fetch(input, init),
      roomName,
      decrypt: (roomId, eventId) => decryptInTab(roomId, eventId, session.userId),
    }
  );
  try {
    return await Promise.race([completed, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const DECRYPT_TIMEOUT_MS = 5000;

async function decryptInTab(
  roomId: string,
  eventId: string,
  userId: string
): Promise<PushFetchView | null> {
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    const answer = await new Promise<PushFetchView | null>((settle) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        settle(null);
      }, DECRYPT_TIMEOUT_MS);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        settle(readPushFetch(event.data));
      };
      client.postMessage({ type: 'sable:push-event', roomId, eventId, userId }, [channel.port2]);
    });
    if (answer !== null) return answer;
  }
  return null;
}

async function closeRead(pushed: PushNotification): Promise<void> {
  if (!('getNotifications' in worker.registration)) return;
  for (const notification of await worker.registration.getNotifications()) {
    const data = notification.data as { roomId?: unknown; userId?: unknown } | undefined;
    if (pushed.room_id !== null && data?.roomId !== pushed.room_id) continue;
    if (
      pushed.user_id !== null &&
      typeof data?.userId === 'string' &&
      data.userId !== pushed.user_id
    ) {
      continue;
    }
    notification.close();
  }
}

async function focused(): Promise<boolean> {
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return clients.some((client) => client.focused);
}

async function alertedAtFor(
  roomId: string,
  userId: string | undefined
): Promise<number | undefined> {
  if (!('getNotifications' in worker.registration)) return undefined;
  let alertedAt: number | undefined;
  for (const notification of await worker.registration.getNotifications()) {
    const data = notification.data as
      | { roomId?: unknown; userId?: unknown; alertedAt?: unknown }
      | undefined;
    if (data?.roomId !== roomId) continue;
    if (userId !== undefined && typeof data.userId === 'string' && data.userId !== userId) continue;
    if (typeof data.alertedAt !== 'number') continue;
    if (alertedAt === undefined || data.alertedAt > alertedAt) alertedAt = data.alertedAt;
  }
  return alertedAt;
}

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as
    | { roomId?: string; userId?: string; eventId?: string | null; invite?: boolean }
    | undefined;
  if (event.action === 'answer' || event.action === 'decline') {
    event.waitUntil(
      watchWorkerOperation(
        'call-action',
        callAction(event.action, data?.roomId, data?.userId, data?.eventId ?? null)
      )
    );
    return;
  }
  if (event.action === 'accept' || event.action === 'decline') {
    event.waitUntil(
      watchWorkerOperation('invite-action', inviteAction(event.action, data?.roomId, data?.userId))
    );
    return;
  }
  if (data?.invite === true) {
    event.waitUntil(watchWorkerOperation('notificationclick', openInvites(data.userId)));
    return;
  }
  event.waitUntil(
    watchWorkerOperation(
      'notificationclick',
      open(data?.roomId, data?.userId, data?.eventId ?? undefined)
    )
  );
});

async function callAction(
  outcome: 'answer' | 'decline',
  roomId: string | undefined,
  userId: string | undefined,
  eventId: string | null
): Promise<void> {
  if (roomId === undefined || userId === undefined) return;
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = clients.at(0);
  if (client) {
    client.postMessage({ type: 'sable:call-action', outcome, roomId, userId, eventId });
    if (outcome === 'answer') await client.focus();
    return;
  }
  if (outcome === 'answer') {
    await worker.clients.openWindow(notificationPermalink(roomId, eventId ?? undefined, userId));
  }
}

async function inviteAction(
  outcome: 'accept' | 'decline',
  roomId: string | undefined,
  userId: string | undefined
): Promise<void> {
  if (roomId === undefined || userId === undefined) return;
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = clients.at(0);
  if (client) {
    client.postMessage({ type: 'sable:invite-action', outcome, roomId, userId });
    if (outcome === 'accept') await client.focus();
    return;
  }
  await worker.clients.openWindow(resolve('/(app)/inbox'));
}

async function openInvites(userId: string | undefined): Promise<void> {
  const clients = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = clients.at(0);
  if (client) {
    client.postMessage({ type: 'sable:open-invites', userId });
    await client.focus();
    return;
  }
  await worker.clients.openWindow(resolve('/(app)/inbox'));
}

async function open(
  roomId: string | undefined,
  userId: string | undefined,
  eventId: string | undefined
): Promise<void> {
  const clients = await worker.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });

  const client = clients.at(0);
  if (client) {
    client.postMessage({ type: 'sable:open-room', roomId, userId, eventId });
    await client.focus();
    return;
  }

  await worker.clients.openWindow(
    roomId === undefined ? resolve('/(app)') : notificationPermalink(roomId, eventId, userId)
  );
}

/** Only the app can re-register a replaced subscription, so it is told to. */
worker.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    watchWorkerOperation(
      'pushsubscriptionchange',
      worker.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) client.postMessage({ type: 'sable:push-resubscribe' });
      })
    )
  );
});
