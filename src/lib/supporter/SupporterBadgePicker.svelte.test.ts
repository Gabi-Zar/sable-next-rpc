// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import { supporterAppearance } from './variants.js';
import SupporterBadgePicker from './SupporterBadgePicker.svelte';

test('typing a hex colour commits it', async () => {
  const onChange = vi.fn();
  render(SupporterBadgePicker, {
    value: supporterAppearance({ variant: 'custom' }),
    onChange,
  });

  const input = screen.getByRole('textbox', { name: /hex/i });
  await userEvent.clear(input);
  await userEvent.type(input, '#112233');
  await userEvent.tab();

  expect(onChange).toHaveBeenCalledWith({ color: '#112233' });
});

test.each([
  ['ukraine', 'Ukraine'],
  ['palestine', 'Palestine'],
  ['cuba', 'Cuba'],
])('selects the %s donor badge', async (variant, label) => {
  const onChange = vi.fn();
  render(SupporterBadgePicker, { value: supporterAppearance(), onChange });

  await userEvent.click(screen.getByRole('radio', { name: label }));

  expect(onChange).toHaveBeenCalledWith({ variant });
});
