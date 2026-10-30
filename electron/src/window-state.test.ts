import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import {
  readWindowState,
  sanitizeWindowState,
  windowStateOnScreen,
  writeWindowState,
  type WindowState,
} from './window-state';

let root: string;
let path: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sable-window-state-'));
  path = join(root, 'window-state.json');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const saved: WindowState = {
  x: 100,
  y: 80,
  width: 1280,
  height: 800,
  maximized: true,
  fullscreen: false,
};

test('round-trips the saved state', () => {
  writeWindowState(path, saved);
  expect(readWindowState(path)).toEqual(saved);
});

test('treats a missing or corrupt file as no saved state', () => {
  expect(readWindowState(path)).toBeUndefined();
  writeFileSync(path, 'not json');
  expect(readWindowState(path)).toBeUndefined();
});

test('rejects unusable bounds', () => {
  expect(sanitizeWindowState(null)).toBeUndefined();
  expect(sanitizeWindowState({ ...saved, width: 0 })).toBeUndefined();
  expect(sanitizeWindowState({ ...saved, height: -1 })).toBeUndefined();
  expect(sanitizeWindowState({ ...saved, x: 'left' })).toBeUndefined();
  expect(sanitizeWindowState({ ...saved, y: Number.NaN })).toBeUndefined();
  expect(sanitizeWindowState({ ...saved, width: Number.POSITIVE_INFINITY })).toBeUndefined();
  expect(sanitizeWindowState({ ...saved, height: 0.4 })).toBeUndefined();
});

test('rounds finite bounds and ignores extra stored properties', () => {
  expect(sanitizeWindowState({ ...saved, x: -0.6, y: 80.4, width: 1279.6, extra: 'old' })).toEqual({
    ...saved,
    x: -1,
  });
});

test('round-trips a window smaller than the desktop minimum on a mobile display', () => {
  const small = { ...saved, x: 0, y: 32, width: 360, height: 460 };
  writeWindowState(path, small);
  expect(readWindowState(path)).toEqual(small);
});

test('treats missing or mistyped flags as off', () => {
  expect(sanitizeWindowState({ ...saved, maximized: 'yes' })).toEqual({
    ...saved,
    maximized: false,
  });
});

test('keeps a window that is on a connected display', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(windowStateOnScreen(saved, [area])).toEqual(saved);
});

test('ignores a window that is entirely off screen', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const offScreen: WindowState = {
    ...saved,
    x: 2500,
    y: 100,
    width: 1000,
    height: 700,
  };
  expect(windowStateOnScreen(offScreen, [area])).toBeUndefined();
});

test('clamps a window that hangs off the edge of its display', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(
    windowStateOnScreen({ ...saved, x: 1800, y: 1000, width: 1280, height: 800 }, [area])
  ).toEqual({ ...saved, x: 640, y: 280 });
});

test('shrinks a window that is larger than the display', () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 };
  expect(windowStateOnScreen(saved, [area])).toEqual({
    ...saved,
    x: 0,
    y: 0,
    width: 1280,
    height: 720,
  });
});

test('fits a restored window inside a mobile work area below the desktop minimum', () => {
  const area = { x: 0, y: 32, width: 360, height: 460 };
  expect(windowStateOnScreen(saved, [area])).toEqual({
    ...saved,
    ...area,
  });
});

test('uses the display the window overlaps the most', () => {
  const displays = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: 1920, y: 0, width: 2560, height: 1440 },
  ];
  const onSecond: WindowState = { ...saved, x: 2000, y: 100, width: 1200, height: 900 };
  expect(windowStateOnScreen(onSecond, displays)).toEqual(onSecond);
});

test('leaves the state alone when the window was maximized or full screen', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(windowStateOnScreen({ ...saved, fullscreen: true }, [area])?.fullscreen).toBe(true);
  expect(windowStateOnScreen(saved, [area])?.maximized).toBe(true);
});

test('writes the state even when the data directory does not exist yet', () => {
  const nested = join(root, 'nested', 'window-state.json');
  writeWindowState(nested, saved);
  expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual(saved);
});
