import { expect, test } from 'vitest';

import { normalizeWheelDelta, wheelZoomFactor } from './wheel-zoom';

test.each([
  { mode: 0, delta: 32, pixels: 32 },
  { mode: 1, delta: 2, pixels: 32 },
  { mode: 2, delta: 1, pixels: 800 },
])('wheel mode $mode converts $delta to $pixels pixels', ({ mode, delta, pixels }) => {
  expect(normalizeWheelDelta(delta, mode, 800)).toBe(pixels);
});

test.each([
  { name: 'wheel zoom in', deltaY: -100, ctrlKey: false, metaKey: false, factor: 1.1 },
  { name: 'wheel zoom out', deltaY: 100, ctrlKey: false, metaKey: false, factor: 0.9 },
  { name: 'pinch zoom in', deltaY: -7, ctrlKey: true, metaKey: false, factor: 1.0725 },
  { name: 'pinch zoom out', deltaY: 7, ctrlKey: true, metaKey: false, factor: 0.9324 },
  { name: 'meta zoom in', deltaY: -7, ctrlKey: false, metaKey: true, factor: 1.0725 },
])('$name', ({ deltaY, ctrlKey, metaKey, factor }) => {
  expect(
    wheelZoomFactor({ deltaMode: 0, ctrlKey, metaKey } as WheelEvent, deltaY, 800)
  ).toBeCloseTo(factor, 4);
});
