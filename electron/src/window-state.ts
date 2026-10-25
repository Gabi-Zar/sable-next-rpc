import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Rectangle } from 'electron';

export interface WindowState extends Rectangle {
  maximized: boolean;
  fullscreen: boolean;
}

export const MIN_WIDTH = 400;
export const MIN_HEIGHT = 500;

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

export function sanitizeWindowState(value: unknown): WindowState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const stored = value as Record<string, unknown>;
  const x = integer(stored.x);
  const y = integer(stored.y);
  const width = integer(stored.width);
  const height = integer(stored.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  if (width <= 0 || height <= 0) return undefined;

  return {
    x,
    y,
    width,
    height,
    maximized: stored.maximized === true,
    fullscreen: stored.fullscreen === true,
  };
}

export function readWindowState(path: string): WindowState | undefined {
  try {
    return sanitizeWindowState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export function writeWindowState(path: string, state: WindowState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
  } catch (error) {
    console.error('[sable window] could not save the window state', error);
  }
}

function overlap(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export function windowStateOnScreen(
  state: WindowState,
  workAreas: readonly Rectangle[]
): WindowState | undefined {
  let area: Rectangle | undefined;
  let overlapWithArea = 0;
  for (const candidate of workAreas) {
    const shared = overlap(state, candidate);
    if (shared > overlapWithArea) {
      area = candidate;
      overlapWithArea = shared;
    }
  }
  if (!area) return undefined;

  const width = Math.min(state.width, area.width);
  const height = Math.min(state.height, area.height);
  return {
    ...state,
    x: Math.min(Math.max(state.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(state.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}
