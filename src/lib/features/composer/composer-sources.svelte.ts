import type { MemberView } from '#src/generated/protocol';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { loadPacks } from '#lib/emoji/load-packs.js';

import { loadAdminCommands, type AdminCommand } from './admin-commands';
import type { BotCommand } from './bot-commands';
import type { PackEmote } from './suggestions';

interface SourcesOptions {
  roomId: () => string;
  roomMembers: () => readonly MemberView[] | undefined;
  botCommandsEnabled: () => boolean;
}

export class ComposerSources {
  loadedMembers = $state.raw<MemberView[]>([]);
  emotes = $state.raw<PackEmote[]>([]);
  botCommands = $state.raw<BotCommand[]>([]);
  adminCommands = $state.raw<readonly AdminCommand[] | null>(null);

  #loadedMembersFor = $state<string | null>(null);
  #loadedEmotesFor = $state<string | null>(null);
  #emotesFor: string | null = null;
  #loadedBotCommandsFor = $state<string | null>(null);
  #botCommandsFor: string | null = null;

  constructor(
    private readonly core: CoreClient,
    private readonly options: SourcesOptions
  ) {}

  forgetEmotes(): void {
    this.#loadedEmotesFor = null;
  }

  forgetBotCommands(): void {
    this.#loadedBotCommandsFor = null;
    this.#botCommandsFor = null;
    this.botCommands = [];
  }

  async loadAdminCatalog(): Promise<void> {
    if (this.adminCommands) return;
    try {
      this.adminCommands = await loadAdminCommands();
    } catch (error) {
      console.warn('[sable composer] loading admin commands failed', error);
    }
  }

  async loadMembers(): Promise<void> {
    if (this.options.roomMembers()?.length || this.#loadedMembersFor === this.options.roomId()) {
      return;
    }
    const roomId = this.options.roomId();
    this.#loadedMembersFor = roomId;
    try {
      this.loadedMembers = await this.core.rpc.members.list({ room_id: roomId, memberships: [] });
    } catch (error) {
      console.warn('[sable composer] loading room members failed', error);
      this.#loadedMembersFor = null;
    }
  }

  async loadEmotes(): Promise<void> {
    if (this.#loadedEmotesFor === this.options.roomId()) return;
    const target = this.options.roomId();
    this.#loadedEmotesFor = target;
    if (this.#emotesFor !== target) this.emotes = [];
    try {
      const complete = await loadPacks(
        this.core.rpc,
        target,
        (packs) => {
          if (this.options.roomId() !== target) return;
          this.#emotesFor = target;
          this.emotes = packs.flatMap((pack) =>
            pack.images
              .filter((image) => image.usage.includes('emoticon'))
              .map((image) => ({ ...image, pack }))
          );
        },
        this.core.session?.account_id ?? null
      );
      if (!complete && this.#loadedEmotesFor === target) this.#loadedEmotesFor = null;
    } catch (error) {
      console.warn('[sable composer] loading emotes failed', error);
      if (this.options.roomId() === target) this.#loadedEmotesFor = null;
    }
  }

  async loadBotCommands(): Promise<void> {
    if (
      !this.options.botCommandsEnabled() ||
      this.#loadedBotCommandsFor === this.options.roomId()
    ) {
      return;
    }
    const target = this.options.roomId();
    this.#loadedBotCommandsFor = target;
    if (this.#botCommandsFor !== target) this.botCommands = [];
    try {
      const commands = await this.core.rpc.room_state.botCommands({ room_id: target });
      if (this.options.roomId() !== target) return;
      this.#botCommandsFor = target;
      this.botCommands = commands;
    } catch (error) {
      console.debug('[sable composer] bot commands unavailable', error);
      if (this.#loadedBotCommandsFor === target) this.#loadedBotCommandsFor = null;
    }
  }
}
