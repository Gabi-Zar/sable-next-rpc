import { expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import AppPageShell from './AppPageShell.svelte';

test.each([
  { maxWidth: undefined, contentWidth: 792, contentLeft: 204 },
  { maxWidth: '40rem', contentWidth: 600, contentLeft: 300 },
  { maxWidth: '56rem', contentWidth: 856, contentLeft: 172 },
  { maxWidth: '100%', contentWidth: 1160, contentLeft: 20 },
])(
  'centers $contentWidth px of content with maxWidth=$maxWidth',
  async ({ maxWidth, contentWidth, contentLeft }) => {
    await page.viewport(1200, 800);
    const screen = await render(AppPageShell, { title: 'Settings', maxWidth });
    const main = screen.getByRole('main').element();
    const header = screen
      .getByRole('heading', { name: 'Settings' })
      .element()
      .closest('header') as HTMLElement;

    expect(main.getBoundingClientRect().width).toBe(1200);
    expect(header.getBoundingClientRect().width).toBe(contentWidth);
    expect(header.getBoundingClientRect().left).toBe(contentLeft);
  }
);
