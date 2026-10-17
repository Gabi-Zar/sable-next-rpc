import { expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));

import { expectNoA11yViolations } from '#lib/test-support/a11y.js';
import { navigated } from '#lib/test-support/app-navigation.js';
import AuthRailHarness from './AuthRailHarness.test.svelte';

for (const width of [1280, 390]) {
  test(`focus starts at the heading (${String(width)}px)`, async () => {
    await page.viewport(width, 844);
    const screen = await render(AuthRailHarness);
    const heading = screen.getByRole('heading', { name: 'Sign in', exact: true });
    await expect.element(heading).toHaveFocus();
    await userEvent.tab();
    await expect.element(screen.getByRole('textbox', { name: 'Account provider' })).toHaveFocus();
    document.getElementById('new-username')?.focus();
    expect(screen.getByRole('textbox', { name: 'New username' }).elements()).toHaveLength(0);
    await expect.element(screen.getByRole('textbox', { name: 'Account provider' })).toHaveFocus();
    await expectNoA11yViolations(screen.container);
  });
}

test('Next and Back focus the active heading', async () => {
  const screen = await render(AuthRailHarness);
  await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
  await expect.element(screen.getByRole('heading', { name: 'Create account' })).toHaveFocus();
  await userEvent.tab();
  await expect.element(screen.getByRole('textbox', { name: 'New username' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
  await expect.element(screen.getByRole('heading', { name: 'Sign in', exact: true })).toHaveFocus();
});

test('startup preserves focus outside the rail', async () => {
  const screen = await render(AuthRailHarness, { booting: true });
  const outside = screen.getByRole('button', { name: 'Outside auth' });
  await userEvent.click(outside);
  await screen.rerender({ booting: false });
  await expect.element(outside).toHaveFocus();
});

test('navigation restores focus only after a router reset', async () => {
  const screen = await render(AuthRailHarness);
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  navigated();
  await expect.element(screen.getByRole('heading', { name: 'Sign in', exact: true })).toHaveFocus();
  const outside = screen.getByRole('button', { name: 'Outside auth' });
  await userEvent.click(outside);
  navigated();
  await expect.element(outside).toHaveFocus();
});
