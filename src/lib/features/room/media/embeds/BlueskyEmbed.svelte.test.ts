// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
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

vi.mock('#lib/platform/files.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/platform/files.js')>()),
  savesNatively: vi.fn(() => false),
}));
vi.mock('#lib/ui/download.js', () => ({ downloadUrl: vi.fn(() => Promise.resolve()) }));

import { savesNatively } from '#lib/platform/files.js';
import { downloadUrl } from '#lib/ui/download.js';
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
  vi.mocked(savesNatively).mockReturnValue(false);
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

test('a video offers the in-app download instead of the webview one in the apps', async () => {
  vi.mocked(savesNatively).mockReturnValue(true);
  const { container } = renderPost({
    $type: 'app.bsky.embed.video',
    video: { ...blob, mimeType: 'video/mp4' },
  });

  await userEvent.click(await screen.findByRole('button', { name: 'Download' }));

  expect(container.querySelector('video')).toHaveAttribute('controlslist', 'nodownload');
  expect(downloadUrl).toHaveBeenCalledWith('blob:media', 'bluesky-video.mp4');
});

test('a video keeps the webview download outside the apps', async () => {
  const { container } = renderPost({ $type: 'app.bsky.embed.video', video: blob });

  await screen.findByText('hello');
  expect(container.querySelector('video')).not.toHaveAttribute('controlslist');
  expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
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
