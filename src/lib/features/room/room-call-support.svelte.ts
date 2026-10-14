import type { CallSupportView } from '#src/generated/protocol';
import type { CoreClient } from '#lib/core/client.svelte.js';
import { runtimeConfig } from '#lib/config/runtime-config.js';

export class RoomCallSupport {
  current = $state<CallSupportView | null>(null);
  fallbackUrl = $state<string | null>(null);

  constructor(core: Pick<CoreClient, 'rpc'>, roomId: () => string) {
    $effect(() => {
      void runtimeConfig().then((config) => {
        this.fallbackUrl = config.calls.livekitServiceUrl;
      });
    });

    $effect(() => {
      const target = roomId();
      const fallback = this.fallbackUrl;
      if (!target) return;

      let current = true;
      this.current = null;
      if (typeof RTCPeerConnection === 'undefined') return;

      void core.rpc.calls
        .support({ room_id: target, livekit_service_url: fallback })
        .then((next) => {
          if (current) this.current = next;
        })
        .catch((error: unknown) => {
          console.debug('[sable room] call support unavailable', error);
        });
      return () => {
        current = false;
      };
    });
  }
}
