import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

type Media = {
  mid: string;
  rtp: { payload: number; codec: string }[];
  fmtp: { payload: number; config: string }[];
};

const runtime = readFileSync(
  new URL('../../../../node_modules/livekit-client/dist/livekit-client.esm.mjs', import.meta.url),
  'utf8'
);
const start = runtime.indexOf('function conformBundledCodecFmtp(');
const end = runtime.indexOf('\n}', start) + 2;
if (start < 0 || end < start) throw new Error('LiveKit codec normalizer not found');
const conform = runInNewContext(`(${runtime.slice(start, end)})`) as (
  media: Media[],
  isPlaceholder: (media: Media) => boolean
) => void;

function video(mid: string, config?: string): Media {
  return {
    mid,
    rtp: [{ payload: 96, codec: 'VP8' }],
    fmtp: config ? [{ payload: 96, config }] : [],
  };
}

test('adds missing VP8 parameters to a bundled placeholder', () => {
  const media = [video('screen', 'x-google-start-bitrate=2813'), video('placeholder')];
  conform(media, (section) => section.mid === 'placeholder');
  expect(media[1].fmtp).toEqual(media[0].fmtp);
});

test('removes a stale fmtp when the active track has no codec parameters', () => {
  const media = [video('placeholder', 'x-google-start-bitrate=2813'), video('screen')];
  conform(media, (section) => section.mid === 'placeholder');
  expect(media[0].fmtp).toEqual([]);
  expect(media[1].fmtp).toEqual([]);
});

test('does not introduce codecs absent from a placeholder', () => {
  const media = [video('screen', 'x-google-start-bitrate=2813'), video('placeholder')];
  media[1].rtp = [{ payload: 98, codec: 'VP9' }];
  conform(media, (section) => section.mid === 'placeholder');
  expect(media[1].fmtp).toEqual([]);
});

test('preserves the active track parameters and updates an existing placeholder fmtp', () => {
  const media = [
    video('placeholder', 'x-google-start-bitrate=1000'),
    video('screen', 'x-google-start-bitrate=2813'),
  ];
  conform(media, (section) => section.mid === 'placeholder');
  expect(media[0].fmtp).toEqual(media[1].fmtp);
  expect(media[1].fmtp[0].config).toBe('x-google-start-bitrate=2813');
});
