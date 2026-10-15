import { expect, test } from 'vitest';

import type { PackImageView } from '#src/generated/protocol';

import { suggestionNode } from './suggestion-node';
import { ROOM_MENTION } from './suggestions';

function emote(shortcode: string): PackImageView {
  return {
    shortcode,
    url: `mxc://example.org/${shortcode}`,
    body: null,
    usage: ['emoticon'],
    info: null,
    source_pack: null,
  };
}

test('commands insert their text', () => {
  const node = suggestionNode('/', { id: 'me', insert: '/me ', label: '/me' }, []);

  expect(node.isText).toBe(true);
  expect(node.text).toBe('/me ');
});

test('members become mentions and the room mention becomes a room ping', () => {
  const member = suggestionNode(
    '@',
    { id: '@alice:example.org', insert: '@Alice', label: 'Alice' },
    []
  );
  const room = suggestionNode('@', { id: ROOM_MENTION, insert: '@room', label: '@room' }, []);

  expect(member.type.name).toBe('mention');
  expect(member.attrs).toMatchObject({ userId: '@alice:example.org', name: '@Alice' });
  expect(room.type.name).toBe('room_ping');
});

test('rooms become mentions named by their label', () => {
  const node = suggestionNode(
    '#',
    { id: '!room:example.org', insert: '#room:example.org', label: '#room' },
    []
  );

  expect(node.type.name).toBe('mention');
  expect(node.attrs).toMatchObject({ userId: '!room:example.org', name: '#room' });
});

test('emotes resolve to their pack image or fall back to text', () => {
  const found = suggestionNode(
    ':',
    { id: 'pack:blob mxc://example.org/other-blob', insert: ':blob:', label: 'blob' },
    [emote('blob'), { ...emote('blob'), url: 'mxc://example.org/other-blob' }]
  );
  const missing = suggestionNode(':', { id: 'pack:gone', insert: ':gone:', label: 'gone' }, []);

  expect(found.type.name).toBe('emoticon');
  expect(found.attrs).toMatchObject({ shortcode: 'blob', url: 'mxc://example.org/other-blob' });
  expect(missing.text).toBe(':gone:');
});
