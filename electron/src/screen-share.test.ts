import { expect, test } from 'vitest';

import { screenShareStreams } from './screen-share';

const source = { id: 'screen:0:0', name: 'Screen 1' };

test('excludes Chromium audio from Windows 10 loopback', () => {
  expect(screenShareStreams(source, true, 'win32', '10.0.19045')).toEqual({
    video: source,
    audio: 'loopbackWithoutChrome',
  });
});

test.each(['10.0.20348', '10.0.22631', '10.0.26100'])(
  'leaves Windows %s audio to native capture',
  (release) => {
    expect(screenShareStreams(source, true, 'win32', release)).toEqual({ video: source });
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

test.each(['22.6.0', '23.2.0', '25.0.0'])('never adds loopback audio on Darwin %s', (release) => {
  expect(screenShareStreams(source, true, 'darwin', release)).toEqual({ video: source });
});

test('leaves Linux audio capture unchanged', () => {
  expect(screenShareStreams(source, true, 'linux', '10.0.26100')).toEqual({ video: source });
});
