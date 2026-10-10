import { createContext } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

import { CoreError } from '#src/transport';
import type { CoreCommands } from '#lib/core/commands.svelte.js';
import { t } from '#lib/i18n.js';

import {
  PIN_MARKER_EVENT_TYPE,
  pinsHash,
  unreadPinCount,
  readPinMarker,
  type PinReadMarker,
} from './pin-marker';

export type PinnedEventCommands = Pick<CoreCommands, 'pinnedEvents' | 'setPinned'> &
  Partial<Pick<CoreCommands, 'roomAccountData' | 'setRoomAccountData'>>;

export function pinErrorMessage(cause: unknown): string {
  return cause instanceof CoreError && cause.detail.code === 'denied'
    ? t('room.pinDenied')
    : t('errors.actionFailed');
}

export class PinnedEvents {
  readonly #ids = new SvelteSet<string>();
  #roomId: string | null = null;
  #generation = 0;

  constructor(private readonly commands: PinnedEventCommands) {}

  has(eventId: string | null | undefined): boolean {
    return eventId !== null && eventId !== undefined && this.#ids.has(eventId);
  }

  async load(roomId: string): Promise<void> {
    const generation = ++this.#generation;
    if (this.#roomId !== roomId) {
      this.#roomId = roomId;
      this.#ids.clear();
    }

    try {
      const ids = await this.commands.pinnedEvents(roomId);
      if (generation !== this.#generation) return;
      this.#replace(ids);
    } catch (error) {
      console.warn('[sable timeline] pinned events unavailable', error);
    }
  }

  set(roomId: string, ids: readonly string[]): void {
    this.#generation += 1;
    this.#roomId = roomId;
    this.#replace(ids);
  }

  async toggle(roomId: string, eventId: string): Promise<void> {
    const generation = ++this.#generation;
    const pinning = !this.has(eventId);
    const previous = pinning && this.#roomId === roomId ? [...this.#ids] : null;
    const restore = previous ? await this.#markOwnPin(roomId, previous, eventId) : null;
    let ids: string[];
    try {
      ids = await this.commands.setPinned(roomId, eventId, pinning);
    } catch (error) {
      if (restore) await this.#writeMarker(roomId, restore.marker);
      throw error;
    }
    if (generation !== this.#generation || this.#roomId !== roomId) return;
    this.#replace(ids);
  }

  async #markOwnPin(
    roomId: string,
    previous: readonly string[],
    eventId: string
  ): Promise<{ marker: PinReadMarker | null } | null> {
    const { roomAccountData } = this.commands;
    if (!roomAccountData) return null;
    try {
      const stored = readPinMarker(await roomAccountData(roomId, PIN_MARKER_EVENT_TYPE));
      const caughtUp =
        previous.length === 0 ||
        (stored !== null && unreadPinCount(previous, stored, await pinsHash(previous)) === 0);
      if (!caughtUp) return null;

      const next = [...previous, eventId];
      await this.#writeMarker(roomId, {
        hash: await pinsHash(next),
        count: next.length,
        last_seen_id: eventId,
      });
      return { marker: stored };
    } catch (error) {
      console.debug('[sable timeline] pin marker not stored', error);
      return null;
    }
  }

  async #writeMarker(roomId: string, marker: PinReadMarker | null): Promise<void> {
    if (marker === null || !this.commands.setRoomAccountData) return;
    try {
      await this.commands.setRoomAccountData(roomId, PIN_MARKER_EVENT_TYPE, marker);
    } catch (error) {
      console.debug('[sable timeline] pin marker not stored', error);
    }
  }

  #replace(ids: readonly string[]): void {
    this.#ids.clear();
    for (const id of ids) this.#ids.add(id);
  }
}

export const [usePinnedEvents, providePinnedEvents] = createContext<PinnedEvents>();
