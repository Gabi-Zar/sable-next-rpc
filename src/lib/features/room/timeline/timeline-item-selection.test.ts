// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';

import { copyText } from '#lib/platform/clipboard.js';

import { selectedText, withSelectedText } from './timeline-item-selection';

vi.mock('#lib/platform/clipboard.js', () => ({ copyText: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function row(text: string): HTMLElement {
  const node = document.createElement('article');
  node.textContent = text;
  document.body.append(node);
  return node;
}

function select(node: Node, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

test('reads a selection made inside the row', () => {
  const message = row('hello world');
  select(message.firstChild as Node, 0, 5);
  expect(selectedText(message)).toBe('hello');
});

test('ignores a collapsed selection, a missing row and a selection elsewhere', () => {
  const message = row('hello world');
  const other = row('elsewhere');
  select(message.firstChild as Node, 2, 2);
  expect(selectedText(message)).toBe('');
  select(other.firstChild as Node, 0, 4);
  expect(selectedText(message)).toBe('');
  expect(selectedText(null)).toBe('');
});

test('only offers copying the selection when there is one', () => {
  const base = { onReply: vi.fn() };
  expect(withSelectedText(base, '')).toBe(base);

  const actions = withSelectedText(base, 'hello');
  expect(actions.onReply).toBe(base.onReply);
  expect(actions.copyTextLabel).toBe('timeline.copySelection');
  actions.onCopyText?.();
  expect(copyText).toHaveBeenCalledWith('hello');
});
