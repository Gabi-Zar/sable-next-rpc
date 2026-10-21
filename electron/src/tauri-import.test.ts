import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { importTauriConfig } from './tauri-import';

let root: string;
let source: string;
let userData: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sable-import-'));
  source = join(root, 'tauri');
  userData = join(root, 'electron');
  mkdirSync(source);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test('copies grants and consent, and carries over disabled smooth scrolling', () => {
  writeFileSync(join(source, 'permissions.json'), '["microphone"]');
  writeFileSync(join(source, 'sentry-consent'), '1');
  writeFileSync(join(source, 'smooth_scrolling'), '0');

  importTauriConfig([join(root, 'missing'), source], userData);

  expect(readFileSync(join(userData, 'permissions.json'), 'utf8')).toBe('["microphone"]');
  expect(readFileSync(join(userData, 'sentry-consent'), 'utf8')).toBe('1');
  expect(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))).toEqual({
    smoothScrolling: false,
  });
});

test('keeps what Electron already has', () => {
  mkdirSync(userData);
  writeFileSync(join(userData, 'permissions.json'), '[]');
  writeFileSync(join(userData, 'settings.json'), '{}');
  writeFileSync(join(source, 'permissions.json'), '["camera"]');
  writeFileSync(join(source, 'smooth_scrolling'), '0');

  importTauriConfig([source], userData);

  expect(readFileSync(join(userData, 'permissions.json'), 'utf8')).toBe('[]');
  expect(readFileSync(join(userData, 'settings.json'), 'utf8')).toBe('{}');
});

test('does nothing without a Tauri config directory', () => {
  importTauriConfig([join(root, 'missing')], userData);
  expect(() => readFileSync(join(userData, 'permissions.json'))).toThrow();
});
