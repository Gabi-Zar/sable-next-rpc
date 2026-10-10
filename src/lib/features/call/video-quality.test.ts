import { afterEach, describe, expect, it, vi } from 'vitest';

import { screenCaptureOptions } from './video-quality.js';

describe('screenCaptureOptions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the display aspect ratio when only the framerate is set', () => {
    vi.stubGlobal('screen', { width: 1920, height: 1200 });
    vi.stubGlobal('devicePixelRatio', 1);
    expect(screenCaptureOptions('auto', '30').resolution).toEqual({
      width: 1728,
      height: 1080,
      frameRate: 30,
    });
  });

  it('passes an explicit size with the framerate', () => {
    expect(screenCaptureOptions('720', '60')).toEqual({
      resolution: { width: 1280, height: 720, frameRate: 60 },
    });
  });

  it('passes nothing when both are automatic', () => {
    expect(screenCaptureOptions('auto', 'auto')).toEqual({});
  });
});
