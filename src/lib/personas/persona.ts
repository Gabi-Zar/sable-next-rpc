import type {
  PerMessageProfileView,
  PersonaSelectionView,
  PersonaTriggerView,
  PersonaView,
} from '#src/generated/protocol';

export function projectPersona(persona: PersonaView, fallback: boolean): PerMessageProfileView {
  return {
    id: persona.id,
    display_name: persona.display_name,
    avatar_url: persona.avatar_url,
    pronouns: persona.pronouns,
    color_on_light: persona.color_on_light,
    color_on_dark: persona.color_on_dark,
    has_fallback: fallback,
  };
}

export function personaById(
  personas: readonly PersonaView[],
  id: string | undefined
): PersonaView | undefined {
  if (id === undefined) return undefined;
  return personas.find((persona) => persona.id === id);
}

export function reorderPersonas(
  personas: readonly PersonaView[],
  from: number,
  to: number
): PersonaView[] {
  if (from === to || from < 0 || to < 0 || from >= personas.length || to >= personas.length) {
    return [...personas];
  }
  const reordered = [...personas];
  const [persona] = reordered.splice(from, 1);
  reordered.splice(to, 0, persona);
  return reordered;
}

function live(selection: PersonaSelectionView | undefined, now: number): boolean {
  if (!selection) return false;
  return selection.valid_until === null || selection.valid_until > now;
}

export type PersonaAssociation = PersonaSelectionView | false | undefined;

export function resolvePersona({
  personas,
  proxied,
  room,
  spaces = [],
  account,
  now,
}: {
  personas: readonly PersonaView[];
  proxied?: PersonaView | undefined;
  room?: PersonaAssociation;
  spaces?: readonly PersonaAssociation[];
  account?: PersonaSelectionView | undefined;
  now: number;
}): PersonaView | undefined {
  let inherited: PersonaView | undefined;
  for (const selection of [room, ...spaces, account]) {
    if (selection === false) return undefined;
    if (!live(selection, now)) continue;
    inherited = personaById(personas, selection?.persona_id);
    if (inherited) break;
  }
  return proxied ?? inherited;
}

export interface ProxyMatch {
  persona: PersonaView;
  body: string;
  trigger: PersonaTriggerView;
}

function matches(trigger: PersonaTriggerView, body: string): boolean {
  const prefix = trigger.prefix ?? '';
  const suffix = trigger.suffix ?? '';
  if (prefix === '' && suffix === '') return false;
  if (body.length < prefix.length + suffix.length) return false;
  return body.startsWith(prefix) && body.endsWith(suffix);
}

export function resolveProxy(
  personas: readonly PersonaView[],
  body: string
): ProxyMatch | undefined {
  for (const persona of personas) {
    const trigger = persona.triggers.find((candidate) => matches(candidate, body));
    if (!trigger) continue;
    if (trigger.keep_trigger) return { persona, body, trigger };

    return {
      persona,
      body: body
        .slice(trigger.prefix?.length ?? 0, body.length - (trigger.suffix?.length ?? 0))
        .trim(),
      trigger,
    };
  }
  return undefined;
}

export interface StrippedHtml {
  html: string | null;
  keepStart: boolean;
  keepEnd: boolean;
}

/** Removes a matched proxy wrapper without discarding the message's rich HTML. */
export function stripProxyHtml(
  formatted: string | null,
  trigger: PersonaTriggerView
): StrippedHtml {
  const kept = { keepStart: false, keepEnd: false };
  if (!formatted || trigger.keep_trigger) return { html: formatted, ...kept };

  const prefix = trigger.prefix ?? '';
  const suffix = trigger.suffix ?? '';
  const document = new DOMParser().parseFromString(formatted, 'text/html');
  const text = document.body.textContent;
  if (
    !text.startsWith(prefix) ||
    !text.endsWith(suffix) ||
    text.length < prefix.length + suffix.length
  ) {
    return { html: null, ...kept };
  }

  const contentNodes = (): (Text | Element)[] => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT
    );
    const nodes: (Text | Element)[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text | Element;
      if (node instanceof Text || node.childNodes.length === 0) nodes.push(node);
    }
    return nodes;
  };
  const remove = (count: number, reverse: boolean): void => {
    for (const node of reverse ? contentNodes().reverse() : contentNodes()) {
      if (count === 0 || !(node instanceof Text)) return;
      const removed = Math.min(count, node.data.length);
      count -= removed;
      node.data = reverse ? node.data.slice(0, -removed) : node.data.slice(removed);
      if (node.data === '') node.remove();
    }
  };
  const trim = (reverse: boolean): boolean => {
    const nodes = contentNodes();
    if (reverse) nodes.reverse();
    for (const [index, node] of nodes.entries()) {
      if (!(node instanceof Text)) return false;
      const data = reverse ? node.data.trimEnd() : node.data.trimStart();
      if (data !== '') {
        node.data = data;
        return false;
      }
      const next = nodes.at(index + 1);
      if (next !== undefined && !(next instanceof Text)) return true;
      node.remove();
    }
    return false;
  };

  remove(prefix.length, false);
  remove(suffix.length, true);
  const keepStart = trim(false);
  const keepEnd = trim(true);
  return { html: document.body.innerHTML, keepStart, keepEnd };
}

/** Strips the trigger from both bodies and trims their edges the same way. */
export function applyProxy(
  raw: string,
  match: ProxyMatch,
  formatted: string | null
): { body: string; formatted: string | null } {
  const { trigger } = match;
  if (trigger.keep_trigger) return { body: raw, formatted };

  const { html, keepStart, keepEnd } = stripProxyHtml(formatted, trigger);
  const inner = raw.slice(trigger.prefix?.length ?? 0, raw.length - (trigger.suffix?.length ?? 0));
  const text = inner.trim();
  const lead = keepStart ? (/^\s*/.exec(inner)?.[0] ?? '') : '';
  const trail = keepEnd ? (/\s*$/.exec(inner)?.[0] ?? '') : '';
  return { body: text === '' ? '' : lead + text + trail, formatted: html };
}

export function triggerLabel(trigger: PersonaTriggerView): string {
  return `${trigger.prefix ?? ''}text${trigger.suffix ?? ''}`;
}
