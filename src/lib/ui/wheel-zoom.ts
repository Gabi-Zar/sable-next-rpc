const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_ZOOM_GAIN = 0.001;
// Touchpad pinches emit smaller deltas than wheel notches.
const PINCH_ZOOM_GAIN = 0.01;

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  viewportHeight: number
): number {
  if (deltaMode === DOM_DELTA_LINE) return delta * WHEEL_LINE_HEIGHT_PX;
  if (deltaMode === DOM_DELTA_PAGE) return delta * viewportHeight;
  return delta;
}

export function wheelZoomFactor(event: WheelEvent, delta: number, viewportHeight: number): number {
  const pixels = normalizeWheelDelta(delta, event.deltaMode, viewportHeight);
  return event.ctrlKey || event.metaKey
    ? Math.exp(-pixels * PINCH_ZOOM_GAIN)
    : 1 - pixels * WHEEL_ZOOM_GAIN;
}
