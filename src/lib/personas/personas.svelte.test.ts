import { expect, test, vi } from 'vitest';

import type { PersonaCatalogView, PersonaView } from '#src/generated/protocol';

import type { CoreClient } from '#lib/core/client.svelte.js';

import { PersonaStore } from './personas.svelte.js';

function persona(id: string): PersonaView {
  return {
    id,
    display_name: id,
    avatar_url: null,
    pronouns: [],
    color_on_light: null,
    color_on_dark: null,
    triggers: [],
    pluralkit: null,
    last_used: null,
    alternate_avatars: null,
  };
}

function catalog(personas: PersonaView[] = []): PersonaCatalogView {
  return { personas, account: null, rooms: {}, disabled_rooms: [] };
}

function setup() {
  const rpc = {
    list: vi.fn().mockResolvedValue(catalog()),
    save: vi.fn(),
    remove: vi.fn(),
    reorder: vi.fn(),
    disableRoom: vi.fn().mockResolvedValue(undefined),
    setSelection: vi.fn().mockResolvedValue(undefined),
  };
  const core = { accountRevision: 0, rpc: { personas: rpc } };
  return { rpc, store: new PersonaStore(core as unknown as CoreClient) };
}

test('a delayed catalog cannot overwrite a save or selection', async () => {
  const { rpc, store } = setup();
  const pending = Promise.withResolvers<PersonaCatalogView>();
  rpc.list.mockReturnValueOnce(pending.promise);
  const loading = store.load();
  const saved = persona('saved');
  rpc.save.mockResolvedValue([saved]);
  await store.save(saved);
  await store.select(null, saved.id);

  pending.resolve(catalog());
  await loading;
  expect(store.personas).toEqual([saved]);
  expect(store.account?.persona_id).toBe(saved.id);
  expect(store.loading).toBe(false);
});

test('a failed mutation leaves the pending catalog usable', async () => {
  const { rpc, store } = setup();
  const pending = Promise.withResolvers<PersonaCatalogView>();
  rpc.list.mockReturnValueOnce(pending.promise);
  const loading = store.load();
  rpc.save.mockRejectedValue(new Error('server unavailable'));
  await expect(store.save(persona('unsaved'))).rejects.toThrow('server unavailable');
  pending.resolve(catalog([persona('saved')]));
  await loading;
  expect(store.personas.map(({ id }) => id)).toEqual(['saved']);
});

test('a delayed load error cannot mark a successful save as failed', async () => {
  const { rpc, store } = setup();
  const pending = Promise.withResolvers<PersonaCatalogView>();
  rpc.list.mockReturnValueOnce(pending.promise);
  const loading = store.load();
  rpc.save.mockResolvedValue([persona('saved')]);
  await store.save(persona('saved'));
  pending.reject(new Error('old load failed'));
  await loading;
  expect(store.personas.map(({ id }) => id)).toEqual(['saved']);
  expect(store.error).toBeNull();
  expect(store.loading).toBe(false);
});
