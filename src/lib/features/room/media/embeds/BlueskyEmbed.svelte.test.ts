// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { ApEmbed } from './bluesky';

vi.mock('#lib/core/context.js');

const bluesky = vi.hoisted(() => ({
  fetchPostDetails: vi.fn(),
  getPostRelationCount: vi.fn(),
}));

vi.mock('./bluesky', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bluesky')>()),
  resolveMiniDoc: vi.fn(() =>
    Promise.resolve({ did: 'did:plc:alice', pds: 'https://pds.test', handle: 'alice.test' })
  ),
  fetchPostDetails: bluesky.fetchPostDetails,
  fetchProfile: vi.fn(() => Promise.resolve(null)),
  getPostRelationCount: bluesky.getPostRelationCount,
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
  bluesky.getPostRelationCount.mockResolvedValue(null);
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

test('a new link does not show the previous post counts', async () => {
  const { rerender } = renderPost({
    $type: 'app.bsky.embed.images',
    images: [{ alt: 'a cat', image: blob }],
  });
  bluesky.getPostRelationCount.mockResolvedValueOnce({ likes: 7, comments: 3, reposts: 2 });
  await rerender({ url: 'https://bsky.app/profile/alice.test/post/3first', encrypted: false });
  expect(await screen.findByText('7')).toBeInTheDocument();

  bluesky.getPostRelationCount.mockReturnValueOnce(new Promise(() => {}));
  bluesky.fetchPostDetails.mockResolvedValue({
    ...post({ $type: 'app.bsky.embed.images', images: [{ alt: 'a cat', image: blob }] }),
    value: { text: 'second post', createdAt: '2026-10-12T00:00:00.000Z' },
  });
  await rerender({ url: 'https://bsky.app/profile/alice.test/post/3second', encrypted: false });

  expect(await screen.findByText('second post')).toBeInTheDocument();
  expect(screen.queryByText('7')).not.toBeInTheDocument();
});
