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
