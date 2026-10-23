import { Window } from 'happy-dom';
import { expect, test, vi } from 'vitest';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { holdMediaUrl, loadMediaUrl } from '#lib/ui/media-url.js';

import { FormattedBodyImages } from './formatted-body-images';

vi.mock('#lib/ui/media-url.js', () => ({
  cachedMediaUrl: () => 'blob:fixture',
  holdMediaUrl: vi.fn(() => () => {}),
  loadMediaUrl: vi.fn(),
  retryMediaUrl: vi.fn(),
}));

const images = new FormattedBodyImages(
  {} as CoreClient,
  () => '',
  () => {}
);

test.each([
  '<img src="mxc://example.org/image" alt="Photo">',
  "<img src='mxc://example.org/image' alt='Photo'>",
  '<img src=mxc://example.org/image alt=Photo>',
  '<IMG SRC = "mxc://example.org/image" alt="Photo">',
])('defers image requests before inserting HTML: %s', (html) => {
  const deferred = images.defer(html);
  expect(deferred).toMatch(/data-sable-src\s*=/i);
  expect(deferred).not.toMatch(/\s+src\s*=/i);
});

test('leaves source-like text and other attributes alone', () => {
  const html = '<p>src="mxc://example.org/image"</p><img data-src="backup" alt="Photo">';
  expect(images.defer(html)).toBe(html);
});

test.each(
  [
    'https://tracker.example/pixel',
    'http://tracker.example/pixel',
    '//tracker.example/pixel',
    '/pixel',
    'data:image/png;base64,AAAA',
    'blob:https://tracker.example/pixel',
    'https&#58;//tracker.example/pixel',
    'mxc://example.org/',
  ].flatMap((source) => ['', 'data-mx-emoticon'].map((marker) => ({ source, marker })))
)('rejects $source ($marker)', ({ source, marker }) => {
  vi.clearAllMocks();
  const window = new Window();
  const node = window.document.createElement('div');
  const paint = vi.fn();
  const resolver = new FormattedBodyImages({} as CoreClient, () => 'wave', paint);
  node.innerHTML = resolver.defer(`<img ${marker} src="${source}" alt="wave">`);
  expect(node.querySelector('img')?.hasAttribute('src')).toBe(false);
  resolver.attach(node as unknown as HTMLElement, false);
  expect(node.querySelector('img')).toBeNull();
  expect(node.textContent).toBe('wave');
  expect(holdMediaUrl).not.toHaveBeenCalled();
  expect(loadMediaUrl).not.toHaveBeenCalled();
  expect(paint).not.toHaveBeenCalled();
});

test.each(['alt=":photo:"', 'title=":photo:"', 'title="photo" height="32"'])(
  'keeps unmarked images ordinary with %s',
  (attributes) => {
    const window = new Window();
    const node = window.document.createElement('div');
    node.innerHTML = images.defer(`<img src="mxc://example.org/photo" ${attributes}>`);
    images.attach(node as unknown as HTMLElement, false);
    expect(node.querySelector('img')?.hasAttribute('data-mx-emoticon')).toBe(false);
  }
);

test.each(['', 'legacy-value'])('recognizes an emote marker with value %s', (value) => {
  const window = new Window();
  const node = window.document.createElement('div');
  const paint = vi.fn();
  const resolver = new FormattedBodyImages({} as CoreClient, () => '', paint);
  node.innerHTML = resolver.defer(`<img data-mx-emoticon="${value}" src="mxc://example.org/wave">`);
  resolver.attach(node as unknown as HTMLElement, false);
  expect(paint).toHaveBeenCalledWith(node.querySelector('img'), 'blob:fixture');
});
