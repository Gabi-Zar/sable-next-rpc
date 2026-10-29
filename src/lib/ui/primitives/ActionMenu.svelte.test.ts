// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$app/state', () => import('#lib/test-support/app-state.js'));
vi.mock('$app/navigation', () => import('#lib/test-support/app-navigation.js'));

import ActionMenuHarness from './ActionMenuHarness.test.svelte';
import { installBrowserCompatibility } from '#lib/platform/browser-compat.js';

const nativeFindLast = Object.getOwnPropertyDescriptor(Array.prototype, 'findLast');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (nativeFindLast) Reflect.defineProperty(Array.prototype, 'findLast', nativeFindLast);
});

function narrowViewport(): void {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

test.each(['native', 'polyfilled'])('Escape dismisses the menu with %s findLast', async (api) => {
  if (api === 'polyfilled') {
    Reflect.deleteProperty(Array.prototype, 'findLast');
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
    await installBrowserCompatibility();
  }
  const user = userEvent.setup();
  render(ActionMenuHarness, { onPick: vi.fn() });

  await user.click(screen.getByRole('button', { name: 'Room options' }));

  expect(await screen.findByRole('menu', { name: 'Room options' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  await user.keyboard('{Escape}');

  await vi.waitFor(() => {
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).toBe('');
  });
});

test('a narrow viewport closes its sheet and then runs the menu action', async () => {
  narrowViewport();
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(ActionMenuHarness, { onPick });

  await user.click(screen.getByRole('button', { name: 'Room options' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Mark as read' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(onPick).toHaveBeenCalledOnce();
  });
});

test('a narrow viewport opens a bottom sheet, and a submenu pushes a second one', async () => {
  narrowViewport();
  const user = userEvent.setup();
  const onPick = vi.fn();
  render(ActionMenuHarness, { onPick });

  await user.click(screen.getByRole('button', { name: 'Room options' }));

  expect(await screen.findAllByRole('dialog')).toHaveLength(1);
  expect(screen.getAllByRole('menuitem').map((row) => row.textContent.trim())).toEqual([
    'Mark as read',
    'Notifications',
  ]);

  await user.click(screen.getByRole('menuitem', { name: 'Notifications' }));

  expect(await screen.findAllByRole('dialog')).toHaveLength(2);
  const checked = screen.getByRole('menuitemradio', { name: 'All messages' });
  expect(checked).toBeChecked();

  await user.click(checked);

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(onPick).toHaveBeenCalledOnce();
  });
});
