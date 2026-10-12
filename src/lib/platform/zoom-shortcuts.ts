import { type as osType } from '@tauri-apps/plugin-os';
import { on } from 'svelte/events';

import { PREFERENCE_RANGES, preferences, setPreference } from '#lib/settings/preferences.svelte.js';

import { supportsDesktopWindow } from './window-decorations';

const STEP = 0.1;
const WHEEL_NOTCH = 100;

function zoomTo(value: number): void {
  const { min, max } = PREFERENCE_RANGES.pageZoom;
  setPreference('pageZoom', Math.round(Math.min(max, Math.max(min, value)) * 100) / 100);
}

function keyZoom(event: KeyboardEvent, isMac: boolean): number | null {
  if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey) return null;
  switch (event.key) {
    case '=':
    case '+':
      return preferences.pageZoom + STEP;
    case '-':
    case '_':
      return preferences.pageZoom - STEP;
    case '0':
      return 1;
    default:
      return null;
  }
}

/** Takes over the webview's own zoom keys so they drive `pageZoom` instead. */
export function trackZoomShortcuts(): () => void {
  if (!supportsDesktopWindow()) return () => {};

  const isMac = osType() === 'macos';
  let wheel = 0;
  const stopKeys = on(window, 'keydown', (event) => {
    if (event.defaultPrevented) return;
    const next = keyZoom(event, isMac);
    if (next === null) return;
    event.preventDefault();
    if (preferences.zoomShortcuts) zoomTo(next);
  });
  const stopWheel = on(
    window,
    'wheel',
    (event) => {
      if (!event.ctrlKey || event.defaultPrevented) return;
      event.preventDefault();
      if (!preferences.zoomShortcuts) return;
      wheel += event.deltaY;
      if (Math.abs(wheel) < WHEEL_NOTCH) return;
      zoomTo(preferences.pageZoom - Math.sign(wheel) * STEP);
      wheel = 0;
    },
    { passive: false }
  );
  return () => {
    stopKeys();
    stopWheel();
  };
}
