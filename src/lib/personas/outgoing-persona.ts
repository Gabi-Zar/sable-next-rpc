import type { PerMessageProfileView } from '#src/generated/protocol';
import { preferences } from '#lib/settings/preferences.svelte.js';
import type { PersonaStore } from './personas.svelte.js';
import { projectPersona, resolvePersona, resolveProxy, stripProxyHtml } from './persona.js';

export function outgoingPersona(
  personas: PersonaStore,
  targetRoomId: string,
  spaceIds: readonly string[],
  body = '',
  formatted: string | null = null
): { body: string; formatted: string | null; persona: PerMessageProfileView | null } {
  const proxied = preferences.personaProxying ? resolveProxy(personas.personas, body) : undefined;
  const personaSelection = personas.selectionFor(null);
  const persona = resolvePersona({
    personas: personas.personas,
    proxied: proxied?.persona,
    room: personas.associationFor(targetRoomId),
    spaces: spaceIds.map((id) => personas.associationFor(id)),
    account: personaSelection ?? undefined,
    now: Date.now(),
  });

  if (!persona) return { body, formatted, persona: null };
  if (proxied && preferences.personaLatching !== 'off') {
    void personas
      .select(preferences.personaLatching === 'room' ? targetRoomId : null, proxied.persona.id)
      .catch((error: unknown) => {
        console.warn('[sable personas] latching failed', error);
      });
  }
  persona.last_used = Date.now();
  personas.save(persona, persona.id).catch((error: unknown) => {
    console.warn('[sable personas] updating timestamp failed', error);
  });

  const avatar_url =
    (personaSelection?.alternate_avatar_id
      ? persona.alternate_avatars?.find(
          (avatar) => avatar.id == personaSelection.alternate_avatar_id
        )
      : undefined
    )?.avatar_url ?? persona.avatar_url;

  return {
    body: proxied?.body ?? body,
    formatted: proxied ? stripProxyHtml(formatted, proxied.trigger) : formatted,
    persona: projectPersona({ ...persona, avatar_url }, preferences.personaFallback),
  };
}
