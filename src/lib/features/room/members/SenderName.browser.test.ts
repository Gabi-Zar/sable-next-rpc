import { expect, test } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { senderDisplayColors } from './members.js';
import SenderName from './SenderName.svelte';

const pronouns = [
  { summary: 'she/her', language: null },
  { summary: 'they/them', language: null },
  { summary: 'xey/xem', language: null },
];

async function mount(width: number, props: { displayName?: string; accountName?: string } = {}) {
  const screen = await render(SenderName, {
    displayName: 'Username',
    colors: senderDisplayColors('@user:example.test', null),
    pronouns,
    ...props,
  });
  const container = screen.container;
  container.style.width = `${width}px`;
  container.style.display = 'block';
  return container;
}

const visiblePills = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('.pronoun-pill-row > .pronoun-pill'));
const pillTexts = (container: HTMLElement) =>
  visiblePills(container).map((pill) => pill.textContent.trim());
function find(container: HTMLElement, selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`${selector} is not rendered`);
  return element;
}
const name = (container: HTMLElement) => find(container, '.sender-identity-name');

async function settle() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

test('shows every pronoun pill when there is room', async () => {
  const container = await mount(600);
  await settle();
  expect(pillTexts(container)).toEqual(['she/her', 'they/them', 'xey/xem']);
});

test('replaces pills that do not fit with a +N pill', async () => {
  const container = await mount(600);
  await settle();
  const full = find(container, '.pronoun-pill-row').offsetWidth;

  container.style.width = `${name(container).offsetWidth + full - 20}px`;
  await settle();
  const texts = pillTexts(container);
  expect(texts.at(-1)).toMatch(/^\+\d+$/);
  expect(texts.length - 1 + Number((texts.at(-1) ?? '').slice(1))).toBe(pronouns.length);
});

test('never overflows or clips a pill at any width, and never truncates the name while it fits', async () => {
  const container = await mount(600);
  await settle();
  const nameWidth = name(container).scrollWidth;

  for (let width = 600; width >= nameWidth; width -= 7) {
    container.style.width = `${width}px`;
    await settle();
    const right = container.getBoundingClientRect().right;
    const row = container.querySelector<HTMLElement>('.pronoun-pill-row');
    for (const pill of visiblePills(container)) {
      expect(
        pill.getBoundingClientRect().right,
        `pill right edge at ${width}px`
      ).toBeLessThanOrEqual(right + 0.5);
      expect(pill.scrollWidth, `pill clipped at ${width}px`).toBeLessThanOrEqual(pill.clientWidth);
    }
    expect(row?.scrollWidth ?? 0, `row overflow at ${width}px`).toBeLessThanOrEqual(
      (row?.clientWidth ?? 0) + 1
    );
    expect(name(container).scrollWidth, `name truncated at ${width}px`).toBeLessThanOrEqual(
      name(container).clientWidth
    );
  }
});

test('shows no pills when not even one fits next to the name', async () => {
  const container = await mount(600);
  await settle();
  container.style.width = `${name(container).offsetWidth + 8}px`;
  await settle();
  expect(visiblePills(container)).toHaveLength(0);
  expect(name(container).textContent.trim()).toBe('Username');
});

test('shrinks the pronouns before the account name', async () => {
  const container = await mount(600, { accountName: '@account:example.test' });
  await settle();
  const via = find(container, '.sender-identity-via');
  const viaWidth = via.offsetWidth;

  container.style.width = `${name(container).offsetWidth + viaWidth + 40}px`;
  await settle();
  expect(via.offsetWidth).toBe(viaWidth);
  expect(visiblePills(container).length).toBeLessThan(pronouns.length + 1);
});

test('truncates a long account name with an ellipsis within its max width', async () => {
  const container = await mount(600, { accountName: `@${'a'.repeat(80)}:example.test` });
  await settle();
  const via = find(container, '.sender-identity-via');
  expect(via.scrollWidth).toBeGreaterThan(via.clientWidth);
  expect(getComputedStyle(via).textOverflow).toBe('ellipsis');
  expect(via.offsetWidth).toBeLessThan(container.offsetWidth / 2);
});

test('caps a very long display name instead of letting it overflow', async () => {
  const container = await mount(600, { displayName: 'W'.repeat(120) });
  await settle();
  const element = name(container);
  expect(element.offsetWidth).toBeLessThanOrEqual(container.offsetWidth);
  expect(element.scrollWidth).toBeGreaterThan(element.clientWidth);
  expect(getComputedStyle(element).textOverflow).toBe('ellipsis');
});
