// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import type { PersonaTriggerView, PersonaView } from '#src/generated/protocol';

import {
  projectPersona,
  reorderPersonas,
  resolvePersona,
  resolveProxy,
  applyProxy,
  stripProxyHtml,
  triggerLabel,
} from './persona';

function persona(id: string, triggers: PersonaTriggerView[] = []): PersonaView {
  return {
    id,
    display_name: id,
    avatar_url: null,
    pronouns: [],
    color_on_light: null,
    color_on_dark: null,
    triggers,
    pluralkit: null,
    last_used: null,
  };
}

function trigger(
  prefix: string | null,
  suffix: string | null = null,
  keep = false
): PersonaTriggerView {
  return { prefix, suffix, keep_trigger: keep };
}

describe('resolveProxy', () => {
  it('strips a prefix trigger', () => {
    const kris = persona('Kris', [trigger('k:')]);
    expect(resolveProxy([kris], 'k:hello')).toEqual({
      persona: kris,
      body: 'hello',
      trigger: trigger('k:'),
    });
  });

  it('strips both ends of a circumfix', () => {
    const kris = persona('Kris', [trigger('[', ']')]);
    expect(resolveProxy([kris], '[hello]')?.body).toBe('hello');
  });

  it.each([
    [trigger('k:'), 'k: \thello\n ', 'hello'],
    [trigger(null, '-k'), ' \thello\n -k', 'hello'],
    [trigger('[', ']'), '[ \thello\n ]', 'hello'],
    [trigger('[', ']'), '[ \t\n ]', ''],
    [trigger('k:', null, true), 'k: hello ', 'k: hello '],
  ])('trims whitespace exposed by stripping %j', (wrapper, body, expected) => {
    expect(resolveProxy([persona('Kris', [wrapper])], body)?.body).toBe(expected);
  });

  it('keeps the trigger when the persona asks it to', () => {
    const kris = persona('Kris', [trigger('k:', null, true)]);
    expect(resolveProxy([kris], 'k:hello')?.body).toBe('k:hello');
  });

  it('takes the first matching persona in catalog order', () => {
    const first = persona('First', [trigger('[', ']')]);
    const second = persona('Second', [trigger('[')]);
    expect(resolveProxy([first, second], '[hello]')?.persona.id).toBe('First');
  });

  it('ignores a trigger with neither end, which would match everything', () => {
    expect(resolveProxy([persona('Kris', [trigger(null, null)])], 'hello')).toBeUndefined();
  });

  it('does not match a body shorter than its two ends together', () => {
    const kris = persona('Kris', [trigger('ab', 'cd')]);
    expect(resolveProxy([kris], 'abd')).toBeUndefined();
  });

  it('returns nothing when no trigger matches', () => {
    expect(resolveProxy([persona('Kris', [trigger('k:')])], 'hello')).toBeUndefined();
  });
});

describe('reorderPersonas', () => {
  it('moves one profile while preserving the rest', () => {
    const profiles = [persona('A'), persona('B'), persona('C')];
    expect(reorderPersonas(profiles, 2, 0).map(({ id }) => id)).toEqual(['C', 'A', 'B']);
  });
});

describe('stripProxyHtml', () => {
  const strip = (formatted: string | null, wrapper: PersonaTriggerView) =>
    stripProxyHtml(formatted, wrapper).html;

  it('retains formatting after removing a prefix trigger', () => {
    expect(strip('k:<code>const answer = 42</code>', trigger('k:'))).toBe(
      '<code>const answer = 42</code>'
    );
  });

  it('retains formatting after removing a circumfix trigger', () => {
    expect(strip('[<em>test</em>]', trigger('[', ']'))).toBe('<em>test</em>');
  });

  it('trims exposed whitespace across formatted text nodes', () => {
    expect(strip('<p>[ <em> hello </em> ]</p>', trigger('[', ']'))).toBe('<p><em>hello</em></p>');
  });

  it('keeps the space before an emote at the end of the message', () => {
    expect(strip('k: hello <img data-mx-emoticon alt=":a:">', trigger('k:'))).toBe(
      'hello <img data-mx-emoticon="" alt=":a:">'
    );
  });

  it('keeps the space after an emote at the start of the message', () => {
    expect(strip('k:<img data-mx-emoticon alt=":a:"> hello', trigger('k:'))).toBe(
      '<img data-mx-emoticon="" alt=":a:"> hello'
    );
  });

  it('keeps the space between a prefix trigger and an emote', () => {
    expect(strip('k: <img data-mx-emoticon alt=":a:">', trigger('k:'))).toBe(
      ' <img data-mx-emoticon="" alt=":a:">'
    );
  });

  it('keeps the space between an emote and a suffix trigger', () => {
    expect(strip('<img data-mx-emoticon alt=":a:"> -k', trigger(null, '-k'))).toBe(
      '<img data-mx-emoticon="" alt=":a:"> '
    );
  });

  it('does not strip HTML that does not contain the trigger as text', () => {
    expect(strip('<em>test</em>', trigger('k:'))).toBeNull();
  });
});

describe('applyProxy', () => {
  const emote = '<img data-mx-emoticon alt=":a:">';
  const apply = (raw: string, html: string | null, wrapper: PersonaTriggerView) => {
    const match = resolveProxy([persona('Kris', [wrapper])], raw);
    if (!match) throw new Error('trigger did not match');
    return applyProxy(raw, match, html);
  };

  it('keeps the space beside an emote in both bodies', () => {
    expect(apply('k: :a:', `k: ${emote}`, trigger('k:'))).toEqual({
      body: ' :a:',
      formatted: ` ${emote.replace('data-mx-emoticon', 'data-mx-emoticon=""')}`,
    });
    expect(apply(':a: -k', `${emote} -k`, trigger(null, '-k')).body).toBe(':a: ');
  });

  it('trims both bodies alike when no emote is at the edge', () => {
    expect(apply('k:  hello  ', '<p>k:  hello  </p>', trigger('k:'))).toEqual({
      body: 'hello',
      formatted: '<p>hello</p>',
    });
  });

  it('keeps an interior space before a trailing emote', () => {
    expect(apply('k: hi :a:', `k: hi ${emote}`, trigger('k:'))).toEqual({
      body: 'hi :a:',
      formatted: `hi ${emote.replace('data-mx-emoticon', 'data-mx-emoticon=""')}`,
    });
  });

  it('drops the rich body when it does not hold the trigger as text', () => {
    expect(apply('k:hello', '<em>hello</em>', trigger('k:'))).toEqual({
      body: 'hello',
      formatted: null,
    });
  });

  it('leaves both bodies alone when the persona keeps the trigger', () => {
    expect(apply('k: hello', '<p>k: hello</p>', trigger('k:', null, true))).toEqual({
      body: 'k: hello',
      formatted: '<p>k: hello</p>',
    });
  });

  it('has no rich body to strip for a plain message', () => {
    expect(apply('k: hello', null, trigger('k:'))).toEqual({ body: 'hello', formatted: null });
  });
});

describe('resolvePersona', () => {
  const kris = persona('Kris');
  const robin = persona('Robin');
  const personas = [kris, robin];

  it('prefers a proxied persona over every stored selection', () => {
    const resolved = resolvePersona({
      personas,
      proxied: robin,
      room: { persona_id: 'Kris', valid_until: null },
      now: 1000,
    });
    expect(resolved?.id).toBe('Robin');
  });

  it('prefers the room over the account', () => {
    const resolved = resolvePersona({
      personas,
      room: { persona_id: 'Robin', valid_until: null },
      account: { persona_id: 'Kris', valid_until: null },
      now: 1000,
    });
    expect(resolved?.id).toBe('Robin');
  });

  it('falls through an expired room selection to the account', () => {
    const resolved = resolvePersona({
      personas,
      room: { persona_id: 'Robin', valid_until: 500 },
      account: { persona_id: 'Kris', valid_until: null },
      now: 1000,
    });
    expect(resolved?.id).toBe('Kris');
  });

  it('prefers the room, then the nearest space, then the account', () => {
    const space = { persona_id: 'Robin', valid_until: null };
    const account = { persona_id: 'Kris', valid_until: null };
    expect(resolvePersona({ personas, spaces: [space], account, now: 1000 })?.id).toBe('Robin');
    expect(
      resolvePersona({
        personas,
        room: { persona_id: 'Kris', valid_until: null },
        spaces: [space],
        now: 1000,
      })?.id
    ).toBe('Kris');
    expect(
      resolvePersona({
        personas,
        spaces: [undefined, { persona_id: 'Gone', valid_until: null }, space],
        account,
        now: 1000,
      })?.id
    ).toBe('Robin');
    expect(
      resolvePersona({
        personas,
        spaces: [{ persona_id: 'Robin', valid_until: 500 }],
        account,
        now: 1000,
      })?.id
    ).toBe('Kris');
  });

  it('stops at a room or space that is off, and takes a proxy with it', () => {
    const account = { persona_id: 'Kris', valid_until: null };
    const space = { persona_id: 'Robin', valid_until: null };
    expect(
      resolvePersona({ personas, spaces: [false, space], account, now: 1000 })
    ).toBeUndefined();
    expect(
      resolvePersona({ personas, proxied: robin, spaces: [false], account, now: 1000 })
    ).toBeUndefined();
    expect(resolvePersona({ personas, room: false, spaces: [space], now: 1000 })).toBeUndefined();
  });

  it('lets a room selection override a space that is off', () => {
    const resolved = resolvePersona({
      personas,
      room: { persona_id: 'Robin', valid_until: null },
      spaces: [false],
      now: 1000,
    });
    expect(resolved?.id).toBe('Robin');
  });

  it('ignores a selection pointing at a deleted persona', () => {
    const resolved = resolvePersona({
      personas,
      room: { persona_id: 'Gone', valid_until: null },
      now: 1000,
    });
    expect(resolved).toBeUndefined();
  });

  it('resolves to nothing with no selection at all', () => {
    expect(resolvePersona({ personas, now: 1000 })).toBeUndefined();
  });
});

describe('projectPersona', () => {
  it('carries the fallback flag the core acts on', () => {
    expect(projectPersona(persona('Kris'), true).has_fallback).toBe(true);
    expect(projectPersona(persona('Kris'), false).has_fallback).toBe(false);
  });

  it('leaves the triggers and the import record behind', () => {
    const projected: Record<string, unknown> = projectPersona(
      persona('Kris', [trigger('k:')]),
      false
    );
    expect(projected.triggers).toBeUndefined();
    expect(projected.pluralkit).toBeUndefined();
  });
});

describe('triggerLabel', () => {
  it('shows where the text sits', () => {
    expect(triggerLabel(trigger('k:'))).toBe('k:text');
    expect(triggerLabel(trigger('[', ']'))).toBe('[text]');
    expect(triggerLabel(trigger(null, '-k'))).toBe('text-k');
  });
});
