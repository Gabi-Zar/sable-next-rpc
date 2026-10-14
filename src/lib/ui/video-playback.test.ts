import { describe, expect, it } from 'vitest';

import type { VideoPlaybackView } from '#src/generated/protocol';
import { videoPlayback } from '#lib/ui/video-playback.js';

const flags = (overrides: Partial<VideoPlaybackView>): VideoPlaybackView => ({
  gif: false,
  autoplay: false,
  looping: false,
  hide_controls: false,
  no_audio: false,
  ...overrides,
});

describe('videoPlayback', () => {
  it('leaves a plain video manual with controls', () => {
    expect(videoPlayback(null)).toEqual({
      autoplay: false,
      loop: false,
      muted: false,
      controls: true,
    });
  });

  it('plays a bridged gif muted, looping and without controls', () => {
    expect(
      videoPlayback(
        flags({ gif: true, autoplay: true, looping: true, hide_controls: true, no_audio: true })
      )
    ).toEqual({ autoplay: true, loop: true, muted: true, controls: false });
  });

  it('treats the gif flag alone as autoplay and loop', () => {
    expect(videoPlayback(flags({ gif: true }))).toMatchObject({ autoplay: true, loop: true });
  });
});
