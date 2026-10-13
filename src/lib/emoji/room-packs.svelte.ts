import type { CoreClient } from '#lib/core/client.svelte.js';
import type { ImagePackView } from '#src/generated/protocol';

import { isPackChange, loadPacks } from './load-packs.js';

/** The image packs usable in a room, reloaded when any pack changes. Create during component init. */
export class RoomPacks {
  current = $state.raw<ImagePackView[]>([]);

  constructor(
    core: Pick<CoreClient, 'rpc' | 'session' | 'subscribeEvents'>,
    roomId: () => string | undefined
  ) {
    $effect(() => {
      const id = roomId();
      this.current = [];
      if (id === undefined) return;

      let live = true;
      const load = () => {
        loadPacks(
          core.rpc,
          id,
          (packs) => {
            if (live) this.current = packs;
          },
          core.session?.account_id ?? null
        ).catch((error: unknown) => {
          console.debug('[sable emotes] image packs unavailable', error);
        });
      };
      load();
      const stop = core.subscribeEvents((event) => {
        if (isPackChange(event)) queueMicrotask(load);
      });
      return () => {
        live = false;
        stop();
      };
    });
  }
}
