// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { afterEach, expect, test } from 'vitest';

import { LOGGED_IN_MARKER } from '#lib/features/auth/flow/auth-flow.svelte.js';
import HomeLanding from './HomeLanding.svelte';

afterEach(() => {
  localStorage.removeItem(LOGGED_IN_MARKER);
});

test('opens Get support in the Sable general room', () => {
  render(HomeLanding, { titleKey: 'nav.unspaced' });

  expect(screen.getByRole('link', { name: 'Get support' })).toHaveAttribute(
    'href',
    '/to/%23general%3Asable.moe'
  );
  expect(screen.getByRole('link', { name: 'Get support' })).not.toHaveAttribute('target');
});

test('welcomes a returning user back', () => {
  localStorage.setItem(LOGGED_IN_MARKER, 'true');
  render(HomeLanding, { titleKey: 'nav.unspaced' });

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back');
});
