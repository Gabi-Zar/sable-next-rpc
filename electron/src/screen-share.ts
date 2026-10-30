import type { DesktopCapturerSource, Streams } from 'electron';
import { release } from 'node:os';
import { supported as audiofoxSupported } from './audiofox';

export function screenShareStreams(
  source: Pick<DesktopCapturerSource, 'id' | 'name'>,
  audioRequested: boolean,
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release()
): Streams {
  const streams: Streams = { video: source };
  if (audioRequested && platform === 'win32') {
    if (audiofoxSupported(platform, osRelease)) return streams;
    // Windows 10 22H2+ supports excluding Chromium's audio.
    // @ts-expect-error Electron supports loopbackWithoutChrome but does not type it.
    streams.audio = Number(osRelease.split('.')[2]) >= 19045 ? 'loopbackWithoutChrome' : 'loopback';
  }
  return streams;
}
