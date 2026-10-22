import { expect, test } from 'vitest';

import { screenShareStreams } from './screen-share';

const source = { id: 'screen:0:0', name: 'Screen 1' };

test.each(['10.0.19045', '10.0.22631', '10.0.26100'])(
  'excludes Chromium audio from Windows loopback on %s',
  (release) => {
    expect(screenShareStreams(source, true, 'win32', release)).toEqual({
      video: source,
      audio: 'loopbackWithoutChrome',
    });
  }
);

test('uses standard loopback on older Windows builds', () => {
  expect(screenShareStreams(source, true, 'win32', '10.0.19044')).toEqual({
    video: source,
    audio: 'loopback',
  });
});

test('does not capture audio when it was not requested', () => {
  expect(screenShareStreams(source, false, 'win32', '10.0.26100')).toEqual({ video: source });
});

test.each(['23.2.0', '23.6.0', '24.0.0', '25.0.0'])(
  'captures macOS system audio on Darwin %s',
  (release) => {
    expect(screenShareStreams(source, true, 'darwin', release)).toEqual({
      video: source,
      audio: 'loopback',
    });
  }
);

test.each(['21.6.0', '22.6.0', '23.0.0', '23.1.0'])(
  'keeps older macOS video-only on Darwin %s',
  (release) => {
    expect(screenShareStreams(source, true, 'darwin', release)).toEqual({ video: source });
  }
);

test('does not capture macOS audio when it was not requested', () => {
  expect(screenShareStreams(source, false, 'darwin', '24.0.0')).toEqual({ video: source });
});

test('leaves Linux audio capture unchanged', () => {
  expect(screenShareStreams(source, true, 'linux', '10.0.26100')).toEqual({ video: source });
});
