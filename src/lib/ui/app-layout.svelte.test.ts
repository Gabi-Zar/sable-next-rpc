// @vitest-environment happy-dom

import type { Window } from 'happy-dom';
import { tick } from 'svelte';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { AppLayout, matchesAppLayout } from './app-layout.svelte.js';

const viewport = (window as unknown as Window).happyDOM;
const originalSize = { width: window.innerWidth, height: window.innerHeight };

afterEach(() => {
  vi.restoreAllMocks();
  viewport.setViewport(originalSize);
});

test.each([
  { width: 390, height: 844, touch: true, wide: false, compactHeight: false },
  { width: 844, height: 479, touch: true, wide: false, compactHeight: true },
  { width: 844, height: 480, touch: true, wide: true, compactHeight: false },
  { width: 844, height: 390, touch: false, wide: true, compactHeight: false },
  { width: 767, height: 800, touch: false, wide: false, compactHeight: false },
  { width: 768, height: 800, touch: false, wide: true, compactHeight: false },
])(
  '$width x $height, touch=$touch selects wide=$wide',
  ({ width, height, touch, wide, compactHeight }) => {
    viewport.setViewport({ width, height });
    vi.spyOn(window.navigator, 'maxTouchPoints', 'get').mockReturnValue(touch ? 1 : 0);

    const layout = new AppLayout();

    expect(layout.current).toBe(wide);
    expect(layout.compactHeight).toBe(compactHeight);
    expect(matchesAppLayout()).toBe(wide);
  }
);

test('updates subscribers when a touch viewport crosses width and height thresholds', async () => {
  viewport.setViewport({ width: 390, height: 844 });
  vi.spyOn(window.navigator, 'maxTouchPoints', 'get').mockReturnValue(1);
  const layout = new AppLayout();
  const changed = vi.fn();
  const stop = $effect.root(() => {
    $effect(() => {
      changed(layout.current, layout.compactHeight);
    });
  });
  onTestFinished(stop);
  await tick();
  expect(changed).toHaveBeenLastCalledWith(false, false);

  viewport.setViewport({ width: 844, height: 390 });
  await tick();
  expect(changed).toHaveBeenLastCalledWith(false, true);

  viewport.setViewport({ height: 768 });
  await tick();
  expect(changed).toHaveBeenLastCalledWith(true, false);

  viewport.setViewport({ width: 390 });
  await tick();
  expect(changed).toHaveBeenLastCalledWith(false, false);
});
