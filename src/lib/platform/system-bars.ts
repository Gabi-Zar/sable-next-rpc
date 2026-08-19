import { invoke, isTauri } from '@tauri-apps/api/core';
import { type as osType } from '@tauri-apps/plugin-os';

const TRANSPARENT = /^(transparent$|rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))/;

function channel(value: number): number {
  const part = value / 255;
  return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, so the threshold matches how the icons will read. */
export function isLightColor(color: string): boolean {
  const parts = color.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return true;
  const [red, green, blue] = parts.map(Number);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue) > 0.179;
}

// First non-transparent background at (x, y): the surface under a bar sets the icon contrast, and may be a drawer or sheet.
function readSurfaceColor(x: number, y: number): string | undefined {
  let el = document.elementFromPoint(x, y);
  while (el) {
    const background = getComputedStyle(el).backgroundColor;
    if (background && !TRANSPARENT.test(background)) return background;
    el = el.parentElement;
  }
  return undefined;
}

type BarCommand = 'set_status_bar_light' | 'set_navigation_bar_light';

function syncEdge(
  command: BarCommand,
  color: string | undefined,
  last: string | undefined
): string {
  if (color === undefined || color === last) return last;
  void invoke(command, { light: isLightColor(color) }).catch(() => {
    // A missing command means an older shell; the bars keep their icons.
  });
  return color;
}

/**
 * Samples each bar's surface and sets the icon contrast, since Android leaves the bars transparent. Returns the cleanup.
 */
export function startSystemBarSync(): () => void {
  if (!isTauri() || osType() !== 'android') return () => {};

  let frame = 0;
  let timer = 0;
  let lastTop = '';
  let lastBottom = '';

  const sample = (): void => {
    frame = 0;
    const x = Math.round(window.innerWidth / 2);
    lastTop = syncEdge('set_status_bar_light', readSurfaceColor(x, 1), lastTop);
    lastBottom = syncEdge(
      'set_navigation_bar_light',
      readSurfaceColor(x, window.innerHeight - 1),
      lastBottom
    );
  };

  const runSample = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(sample);
  };
  const schedule = (): void => {
    runSample();
    window.clearTimeout(timer);
    timer = window.setTimeout(runSample, 120);
  };

  runSample();
  const observer = new MutationObserver(schedule);
  // childList = navigation and overlays; class/style = theme swaps, recolors.
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
  window.addEventListener('resize', schedule);

  return () => {
    window.clearTimeout(timer);
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule);
  };
}
