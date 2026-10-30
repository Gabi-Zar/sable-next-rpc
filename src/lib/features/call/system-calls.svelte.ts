import { endSystemCall, fulfillSystemAnswer } from '#lib/platform/calls.js';

import type { CallSession } from './call-session.svelte';

type CallState = Pick<CallSession, 'lifecycle' | 'roomId'>;

export class SystemCalls {
  #answered = $state<{ callId: string; roomId: string } | null>(null);
  readonly #session: CallState;

  constructor(session: CallState) {
    this.#session = session;
  }

  async answer(uuid: string, callId: string, roomId: string, join: () => Promise<void>) {
    try {
      await join();
      this.#answered = { callId, roomId };
    } catch (error) {
      console.warn('[sable call] system answer not joined', error);
    } finally {
      void fulfillSystemAnswer(uuid);
    }
  }

  track(): void {
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
