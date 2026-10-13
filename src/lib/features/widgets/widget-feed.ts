import type { ClientWidgetApi, IRoomEvent } from 'matrix-widget-api';

import type { CoreClient } from '#lib/core/client.svelte.js';

import type { SableWidgetDriver } from './widget-driver.js';

const consumers = new WeakMap<CoreClient, number>();

function setFeed(core: CoreClient, enabled: boolean): void {
  core.rpc.widgets.setWidgetFeed({ enabled }).catch((error: unknown) => {
    console.warn('[sable widgets] toggling the widget feed failed', error);
  });
}

function feedFailed(error: unknown): void {
  console.debug('[sable widgets] an event could not be fed to the widget', error);
}

function acquire(core: CoreClient): void {
  const count = consumers.get(core) ?? 0;
  consumers.set(core, count + 1);
  if (count === 0) setFeed(core, true);
}

function release(core: CoreClient): void {
  const count = (consumers.get(core) ?? 1) - 1;
  consumers.set(core, count);
  if (count === 0) setFeed(core, false);
}

export function startWidgetFeed(
  core: CoreClient,
  api: ClientWidgetApi,
  driver: SableWidgetDriver
): () => void {
  acquire(core);
  const unsubscribe = core.subscribeEvents((event) => {
    if (event.type === 'widget_room_event') {
      const raw = event.event as IRoomEvent;
      driver.noteRooms([raw.room_id]);
      api.feedEvent(raw).catch(feedFailed);
      if ('state_key' in raw) api.feedStateUpdate(raw).catch(feedFailed);
    } else if (event.type === 'widget_to_device') {
      const { type, sender, content } = event.event as {
        type: string;
        sender: string;
        content: Record<string, unknown>;
      };
      api.feedToDevice({ type, sender, content }, event.encrypted).catch(feedFailed);
    }
  });

  return () => {
    unsubscribe();
    release(core);
  };
}
