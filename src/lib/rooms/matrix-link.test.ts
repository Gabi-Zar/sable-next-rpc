import { expect, test } from 'vitest';

import { parseMatrixLink } from './matrix-link';

test.each([
  ['matrix:u/alice:example.org', { kind: 'user', user_id: '@alice:example.org' }],
  [
    'matrix:roomid/room:example.org/e/event',
    { kind: 'event', room_id: '!room:example.org', event_id: '$event' },
  ],
  ['https://matrix.to/#/#lobby:example.org', { kind: 'room', room_id: '#lobby:example.org' }],
  [
    'https://matrix.to/#/!room:example.org/$event',
    { kind: 'event', room_id: '!room:example.org', event_id: '$event' },
  ],
])('parses %s', (href, expected) => {
  expect(parseMatrixLink(href)).toEqual(expected);
});

/* The spec's own matrix.to examples, which all carry `via` because a room id is
   not routable without one. matrix.to puts it inside the fragment. */
test.each([
  [
    'https://matrix.to/#/!somewhere:example.org?via=elsewhere.ca',
    { kind: 'room', room_id: '!somewhere:example.org' },
  ],
  [
    'https://matrix.to/#/!somewhere:example.org/$event:example.org?via=elsewhere.ca',
    { kind: 'event', room_id: '!somewhere:example.org', event_id: '$event:example.org' },
  ],
  [
    'matrix:roomid/somewhere:example.org/e/event?via=elsewhere.ca',
    { kind: 'event', room_id: '!somewhere:example.org', event_id: '$event' },
  ],
])('keeps via out of the ids in %s', (href, expected) => {
  expect(parseMatrixLink(href)).toEqual(expected);
});

test('parses the shared Sable room permalink', () => {
  expect(
    parseMatrixLink(
      'https://matrix.to/#/!6DYBIzUfDoKmqk53wyRqcod2G7LTcR9fEm9XBfaenNI?via=sable.moe'
    )
  ).toEqual({ kind: 'room', room_id: '!6DYBIzUfDoKmqk53wyRqcod2G7LTcR9fEm9XBfaenNI' });
});

test('does not treat arbitrary URLs as Matrix links', () => {
  expect(parseMatrixLink('https://example.org/#/!room:example.org')).toBeNull();
});

test.each([
  'matrix:u/alice:example.org/e/event',
  'matrix:roomid/room:example.org/e/event/extra',
  'matrix:roomid/room:example.org/x/event',
  'matrix:person/alice:example.org',
  'https://matrix.to/#/',
  'https://matrix.to/#/alice:example.org',
])('rejects %s', (href) => {
  expect(parseMatrixLink(href)).toBeNull();
});

test.each([
  [
    'matrix://reserved.example/u/alice:example.org',
    { kind: 'user', user_id: '@alice:example.org' },
  ],
  ['matrix:///r/lobby:example.org', { kind: 'room', room_id: '#lobby:example.org' }],
  [
    'matrix:roomid/a%2Fb:example.org/event/c%2Fd',
    { kind: 'event', room_id: '!a/b:example.org', event_id: '$c/d' },
  ],
  [
    'MATRIX:user/alice:example.org?action=chat#reserved',
    { kind: 'user', user_id: '@alice:example.org' },
  ],
])('supports the complete Matrix URI path in %s', (href, expected) => {
  expect(parseMatrixLink(href)).toEqual(expected);
});

test.each([
  'matrix:/u/alice:example.org',
  'matrix://reserved.example',
  'matrix:u/%FF',
  'matrix:u/%ZZ',
  'https://matrix.to/#@alice:example.org',
  'https://matrix.to/#/!room:example.org/$event/extra',
  'https://matrix.to/other/#/!room:example.org',
])('refuses malformed URI %s', (href) => {
  expect(parseMatrixLink(href)).toBeNull();
});
