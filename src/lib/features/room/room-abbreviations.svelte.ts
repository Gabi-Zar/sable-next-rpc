import { createContext } from 'svelte';

import type { Rpc } from '#src/generated/protocol';

import { abbreviationPattern, buildAbbreviationMap, type AbbreviationMap } from './abbreviations';
import type { AbbreviationEntry } from './settings/abbreviations';

export const abbreviationChanges = $state({ version: 0 });

export function abbreviationsChanged(): void {
  abbreviationChanges.version += 1;
}

export class RoomAbbreviations {
  #map = $state.raw<AbbreviationMap>(buildAbbreviationMap([]));
  #pattern = $derived(abbreviationPattern(this.#map));
  #roomId: string | null = null;
  #generation = 0;

  constructor(private readonly rpc: { room_state: Pick<Rpc['room_state'], 'roomAbbreviations'> }) {}

  get map(): AbbreviationMap {
    return this.#map;
  }

  get pattern(): RegExp | null {
    return this.#pattern;
  }

  async load(roomId: string, spaceIds: readonly string[]): Promise<void> {
    const generation = ++this.#generation;
    if (this.#roomId !== roomId) {
      this.#roomId = roomId;
      this.#map = buildAbbreviationMap([]);
    }

    const groups = await Promise.all([...spaceIds, roomId].map((id) => this.#entries(id)));
    if (generation !== this.#generation) return;
    this.#map = buildAbbreviationMap(groups.flat());
  }

  async #entries(roomId: string): Promise<AbbreviationEntry[]> {
    try {
      return await this.rpc.room_state.roomAbbreviations({ room_id: roomId });
    } catch (error) {
      console.debug('[sable room] abbreviations unavailable', error);
      return [];
    }
  }
}

export const [useRoomAbbreviations, provideRoomAbbreviations, hasRoomAbbreviations] =
  createContext<RoomAbbreviations>();
