<script lang="ts">
  import { RoomEvent } from 'livekit-client';
  import { createSubscriber } from 'svelte/reactivity';
  import type { CallTelemetry } from './call-telemetry';
  import type { CallTransportRoom } from './call-transport';
  import Button from '#lib/ui/primitives/Button.svelte';
  import { i18n } from '#lib/i18n.js';

  interface Props {
    rooms: readonly CallTransportRoom[];
    telemetry?: Pick<CallTelemetry, 'event' | 'failure' | 'step'>;
  }

  let { rooms, telemetry }: Props = $props();
  let subscribe = $derived.by(() => {
    const currentRooms = rooms;
    return createSubscriber((update) => {
      for (const { room } of currentRooms) {
        room.on(RoomEvent.AudioPlaybackStatusChanged, update);
      }

      return () => {
        for (const { room } of currentRooms) {
          room.off(RoomEvent.AudioPlaybackStatusChanged, update);
        }
      };
    });
  });
  let hasBlockedAudio = $derived.by(() => {
    subscribe();
    return rooms.some(({ room }) => !room.canPlaybackAudio);
  });

  function enableAudio(): void {
    const blockedRooms = rooms.filter(({ room }) => !room.canPlaybackAudio);
    const action = (): Promise<unknown[]> =>
      Promise.all(blockedRooms.map(({ room }) => room.startAudio()));
    const attempt = telemetry?.step
      ? telemetry.step('call.audio.playback_enable', action)
      : action();
    void attempt.catch((error: unknown) => telemetry?.failure('call.audio.playback_enable', error));
  }
</script>

{#if hasBlockedAudio}
  <Button variant="primary" size="small" onclick={enableAudio}>{i18n.t('call.enableAudio')}</Button>
{/if}
