import { afterEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted<{ embeds: { serviceUrl: string | null } }>(() => ({
  embeds: { serviceUrl: 'https://embeds.test' },
}));

vi.mock('#lib/config/runtime-config.js', () => ({ runtimeConfig: () => Promise.resolve(config) }));

import { parseYoutubeLink, youtubePlayerUrl, type YoutubeVideo } from './youtube';

afterEach(() => {
  config.embeds.serviceUrl = 'https://embeds.test';
  vi.unstubAllGlobals();
});

describe('parseYoutubeLink', () => {
  it.each([
    'https://www.youtube.com/watch?v=MTn_bhTVr2U',
    'https://youtube.com/watch?v=MTn_bhTVr2U&list=RDjcB4zu4KX10&index=3',
    'https://m.youtube.com/watch?v=MTn_bhTVr2U',
    'https://youtu.be/MTn_bhTVr2U?si=abc',
    'https://youtube.com/shorts/MTn_bhTVr2U?si=abc',
  ])('reads the video id from %s', (href) => {
    expect(parseYoutubeLink(href)?.id).toBe('MTn_bhTVr2U');
  });

  it.each([
    'https://www.youtube.com/',
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=short',
    'https://youtu.be/MTn_bhTVr2U/extra',
    'https://evil.example/watch?v=MTn_bhTVr2U',
    'https://notyoutube.com/watch?v=MTn_bhTVr2U',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (href) => {
    expect(parseYoutubeLink(href)).toBeNull();
  });

  it.each([
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['1h2m3s', 3723],
    ['junk', null],
    ['0', null],
  ])('reads the start time %s', (t, start) => {
    expect(parseYoutubeLink(`https://youtu.be/MTn_bhTVr2U?t=${t}`)?.start).toBe(start);
  });
});

describe('youtubePlayerUrl', () => {
  const video: YoutubeVideo = {
    id: 'MTn_bhTVr2U',
    start: 90,
  };

  it.each(['http:', 'https:'])('plays directly over %s', async (protocol) => {
    vi.stubGlobal('location', { protocol });
    await expect(youtubePlayerUrl(video)).resolves.toBe(
      'https://www.youtube-nocookie.com/embed/MTn_bhTVr2U?autoplay=1&start=90'
    );
  });

  it.each(['tauri:', 'sable-app:'])('uses the embed service over %s', async (protocol) => {
    vi.stubGlobal('location', { protocol });
    await expect(youtubePlayerUrl(video)).resolves.toBe(
      'https://embeds.test/_soliditas/embed/youtube?v=MTn_bhTVr2U&start=90'
    );
  });

  it('plays directly without an embed service', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:' });
    config.embeds.serviceUrl = null;
    await expect(youtubePlayerUrl(video)).resolves.toBe(
      'https://www.youtube-nocookie.com/embed/MTn_bhTVr2U?autoplay=1&start=90'
    );
  });

  it.each([
    ['https:', null, 'https://www.youtube-nocookie.com/embed/MTn_bhTVr2U?autoplay=1'],
    ['tauri:', null, 'https://embeds.test/_soliditas/embed/youtube?v=MTn_bhTVr2U'],
    ['tauri:', 0, 'https://embeds.test/_soliditas/embed/youtube?v=MTn_bhTVr2U&start=0'],
  ] as const)('plays over %s from %s', async (protocol, start, expected) => {
    vi.stubGlobal('location', { protocol });
    await expect(youtubePlayerUrl({ ...video, start })).resolves.toBe(expected);
  });
});
