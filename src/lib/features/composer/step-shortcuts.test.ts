// @vitest-environment happy-dom

import { expect, test } from 'vitest';

import { editStep, replyStep } from './step-shortcuts';

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, ...init });
}

test('maps the reply step bindings to directions', () => {
  expect(replyStep(press('ArrowUp', { ctrlKey: true }))).toBe('older');
  expect(replyStep(press('ArrowDown', { ctrlKey: true }))).toBe('newer');
  expect(replyStep(press('ArrowUp'))).toBeUndefined();
});

test('maps the edit step bindings to directions', () => {
  expect(editStep(press('ArrowUp', { ctrlKey: true, shiftKey: true }))).toBe('older');
  expect(editStep(press('ArrowDown', { ctrlKey: true, shiftKey: true }))).toBe('newer');
  expect(editStep(press('ArrowUp', { ctrlKey: true }))).toBeUndefined();
});

test('does not treat edit bindings as reply steps', () => {
  expect(replyStep(press('ArrowUp', { ctrlKey: true, shiftKey: true }))).toBeUndefined();
});
