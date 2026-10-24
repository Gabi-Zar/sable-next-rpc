import { untrack } from 'svelte';

import {
  endSystemCall,
  fulfillSystemAnswer,
  reportSystemCallConnected,
  startSystemCall,
} from '#lib/platform/calls.js';
import { isIos } from '#lib/platform/os.js';

import type { CallSession } from './call-session.svelte';

type CallState = Pick<CallSession, 'lifecycle' | 'roomId' | 'nativeCallId'>;

export class SystemCalls {
  #answered = $state<{ callId: string; roomId: string } | null>(null);
  #answering = false;
  readonly #session: CallState;
  readonly #roomName: (roomId: string) => string | null | undefined;

  constructor(session: CallState, roomName: (roomId: string) => string | null | undefined) {
    this.#session = session;
    this.#roomName = roomName;
  }

  async answer(uuid: string, callId: string, roomId: string, join: () => Promise<void>) {
    this.#answering = true;
    try {
      await join();
      this.#answered = { callId, roomId };
    } catch (error) {
      console.debug('[sable call] system answer not joined', error);
    } finally {
      this.#answering = false;
      void fulfillSystemAnswer(uuid);
    }
  }

  track(): void {
    // iOS audio stays off until CallKit activates a call. The plugin re-gates
    // audio on connect, so the call is reported after connecting.
    $effect(() => {
      const { roomId, nativeCallId: callId, lifecycle } = this.#session;
      if (!isIos() || lifecycle !== 'active' || roomId === null || !callId) return;
      if (this.#answering || untrack(() => this.#answered) !== null) return;

      const uuid = crypto.randomUUID();
      let ended = false;
      void startSystemCall({
        callId,
        uuid,
        callerName: untrack(() => this.#roomName(roomId)) ?? roomId,
      }).then((started) => {
        if (!started) console.warn('[sable call] system call not started');
        else if (ended) void endSystemCall(callId);
        else void reportSystemCallConnected(uuid);
      });
      return () => {
        ended = true;
        void endSystemCall(callId);
      };
    });

    $effect(() => {
      const answered = this.#answered;
      if (
        answered === null ||
        (this.#session.roomId === answered.roomId && this.#session.lifecycle !== 'failed')
      ) {
        return;
      }
      this.#answered = null;
      void endSystemCall(answered.callId);
    });
  }
}
