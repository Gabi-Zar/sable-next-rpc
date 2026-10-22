import type { DesktopCapturerSource, Streams } from 'electron';
import { release } from 'node:os';

export function screenShareStreams(
  source: Pick<DesktopCapturerSource, 'id' | 'name'>,
  audioRequested: boolean,
  platform: NodeJS.Platform = process.platform,
  osRelease: string = release()
): Streams {
  const streams: Streams = { video: source };
  if (audioRequested && platform === 'win32') {
    // Windows 10 22H2+ supports excluding Chromium's audio.
    // @ts-expect-error Electron supports loopbackWithoutChrome but does not type it.
    streams.audio = Number(osRelease.split('.')[2]) >= 19045 ? 'loopbackWithoutChrome' : 'loopback';
  } else if (audioRequested && platform === 'darwin') {
    // CoreAudio Taps require macOS 14.2 (Darwin 23.2) or newer.
    const [major, minor] = osRelease.split('.').map(Number);
    if (major > 23 || (major === 23 && minor >= 2)) streams.audio = 'loopback';
  }
  return streams;
}
