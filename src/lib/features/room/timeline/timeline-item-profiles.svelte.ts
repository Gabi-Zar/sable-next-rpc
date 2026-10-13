import type { ProfileView } from '#src/generated/protocol';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { ProfileSlot } from '#lib/profile/user-profile.svelte.js';

const FIRST_LOOKUP_DELAY_MS = 300;
const RETRY_DELAYS_MS = [3000, 10_000, 30_000];

export class TimelineItemProfiles {
  readonly #sender: ProfileSlot;
  readonly #reply: ProfileSlot;
  readonly #unsubscribe: () => void;

  constructor(core: CoreClient) {
    this.#sender = new ProfileSlot(core, FIRST_LOOKUP_DELAY_MS, RETRY_DELAYS_MS);
    this.#reply = new ProfileSlot(core, FIRST_LOOKUP_DELAY_MS, RETRY_DELAYS_MS);
    this.#unsubscribe = core.onProfileChanged((userId) => {
      this.#sender.refresh(userId);
      this.#reply.refresh(userId);
    });
  }

  get sender(): ProfileView | null {
    return this.#sender.profile;
  }

  get reply(): ProfileView | null {
    return this.#reply.profile;
  }

  sync(senderId: string | null, replyId: string | null, preview: boolean): void {
    this.#sender.sync(senderId, preview);
    this.#reply.sync(replyId, preview);
  }

  dispose(): void {
    this.#unsubscribe();
    this.#sender.dispose();
    this.#reply.dispose();
  }
}
