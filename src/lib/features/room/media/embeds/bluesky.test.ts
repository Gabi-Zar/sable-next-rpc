import { expect, test } from 'vitest';

import { parseAtUri } from './bluesky';

test('reads a post URI with a DID or handle', () => {
  for (const repo of ['did:plc:abc123', 'example.test']) {
    expect(parseAtUri(`at://${repo}/app.bsky.feed.post/3abc`)).toEqual({
      repo,
      collection: 'app.bsky.feed.post',
      key: '3abc',
    });
  }
});

test.each([
  'not an at uri',
  'https://example.test/app.bsky.feed.post/3abc',
  'at://example.test/app.bsky.actor.profile/self',
  'at://example.test/app.bsky.feed.post',
])('rejects a URI that does not identify a post: %s', (uri) => {
  expect(parseAtUri(uri)).toBeNull();
});
