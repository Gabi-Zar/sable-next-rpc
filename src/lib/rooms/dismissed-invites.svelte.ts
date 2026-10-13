import type { CoreClient } from '#lib/core/client.svelte.js';
import { AccountDataSync } from '#lib/core/account-data-sync.js';

export const DISMISSED_INVITES_EVENT = 'moe.sable.dismissed_invites';

class DismissedInvites {
  roomIds = $state.raw<ReadonlySet<string>>(new Set());

  private readonly sync = new AccountDataSync([DISMISSED_INVITES_EVENT], (generation) =>
    this.pull(generation)
  );

  start(core: CoreClient): void {
    this.sync.start(core);
  }

  stop(): void {
    this.sync.stop();
    this.roomIds = new Set();
  }

  has(roomId: string): boolean {
    return this.roomIds.has(roomId);
  }

  dismiss(roomId: string): Promise<void> {
    return this.write(roomId, true);
  }

  restore(roomId: string): Promise<void> {
    return this.write(roomId, false);
  }

  private async pull(generation: number): Promise<void> {
    try {
      const core = this.sync.core;
      if (core === null) return;
      const roomIds = await core.rpc.account.dismissedInvites();
      if (generation === this.sync.generation) this.roomIds = new Set(roomIds);
    } catch (error) {
      console.debug('[sable room] dismissed invites unavailable', error);
    }
  }

  private async write(roomId: string, dismissed: boolean): Promise<void> {
    const core = this.sync.core;
    if (core === null) return;
    const generation = this.sync.generation;
    const previous = this.roomIds;
    const next = dismissed
      ? new Set([...previous, roomId])
      : new Set([...previous].filter((entry) => entry !== roomId));
    this.roomIds = next;
    try {
      const stored = await core.rpc.account.setInviteDismissed({ room_id: roomId, dismissed });
      if (generation === this.sync.generation) this.roomIds = new Set(stored);
    } catch (error) {
      if (this.roomIds === next) this.roomIds = previous;
      throw error;
    }
  }
}

export const dismissedInvites = new DismissedInvites();
