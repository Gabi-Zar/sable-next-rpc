import type { CoreClient } from '#lib/core/client.svelte.js';
import { sendMessage } from '#lib/core/api/messages.svelte.js';

import { dequeue, dueMessages } from '#lib/composer/scheduled-queue.svelte.js';

const TICK_MS = 15_000;

export function watchScheduledQueue(core: CoreClient): () => void {
  let sending = false;
  let disposed = false;
  const accountId = core.session?.account_id ?? '';
  const revision = core.accountRevision;

  const isCurrent = (): boolean =>
    !disposed &&
    core.accountRevision === revision &&
    (core.session?.account_id ?? '') === accountId;

  const tick = async (): Promise<void> => {
    const deviceId = core.session?.device_id;
    if (!isCurrent() || sending || deviceId === undefined) return;

    const due = dueMessages(Date.now(), deviceId, accountId);
    if (due.length === 0) return;

    sending = true;
    try {
      for (const message of due) {
        if (!isCurrent()) break;
        try {
          await sendMessage(core.rpc, message.roomId, message.body, {
            formatted: message.formatted,
            persona: message.persona ?? null,
          });
          dequeue(message.id, accountId);
        } catch (error) {
          console.warn('[sable composer] a scheduled message could not be sent', error);
        }
      }
    } finally {
      sending = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
