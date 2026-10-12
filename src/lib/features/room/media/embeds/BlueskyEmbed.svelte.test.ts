// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ApEmbed } from './bluesky';

vi.mock('#lib/core/context.js');

const bluesky = vi.hoisted(() => ({
  fetchPostDetails: vi.fn(),
}));

vi.mock('./bluesky', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bluesky')>()),
  resolveMiniDoc: vi.fn(() =>
    Promise.resolve({ did: 'did:plc:alice', pds: 'https://pds.test', handle: 'alice.test' })
  ),
  fetchPostDetails: bluesky.fetchPostDetails,
  fetchProfile: vi.fn(() => Promise.resolve(null)),
  getPostRelationCount: vi.fn(() => Promise.resolve(null)),
}));

import BlueskyEmbed from './BlueskyEmbed.svelte';

const blob = {
  $type: 'blob',
  size: 1,
  ref: { $link: 'bafy' },
  mimeType: 'image/png',
  'moe.sable.blob': new Blob(['x']),
} as const;

function post(embed: ApEmbed) {
  return {
    uri: 'at://did:plc:alice/app.bsky.feed.post/3abc',
    cid: 'bafypost',
    value: { text: 'hello', createdAt: '2026-10-12T00:00:00.000Z', embed },
  };
}

function renderPost(embed: ApEmbed) {
  bluesky.fetchPostDetails.mockResolvedValue(post(embed));
  return render(BlueskyEmbed, {
    url: 'https://bsky.app/profile/alice.test/post/3abc',
    encrypted: false,
  });
}

beforeEach(() => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media');
});

test('an image without an aspect ratio still renders', async () => {
  renderPost({ $type: 'app.bsky.embed.images', images: [{ alt: 'a cat', image: blob }] });

  expect(await screen.findByRole('img', { name: 'a cat' })).not.toHaveAttribute('width');
});

test('a video without a presentation or aspect ratio plays with controls', async () => {
  const { container } = renderPost({ $type: 'app.bsky.embed.video', video: blob });

  await screen.findByText('hello');
  const video = container.querySelector('video');
  expect(video).toHaveAttribute('controls');
  expect(video).not.toHaveAttribute('width');
});
