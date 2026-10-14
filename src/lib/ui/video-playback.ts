import type { VideoPlaybackView } from '#src/generated/protocol';

export interface VideoPlayback {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  controls: boolean;
}

export function videoPlayback(flags: VideoPlaybackView | null): VideoPlayback {
  return {
    autoplay: flags !== null && (flags.autoplay || flags.gif),
    loop: flags !== null && (flags.looping || flags.gif),
    muted: flags?.no_audio === true,
    controls: flags?.hide_controls !== true,
  };
}
