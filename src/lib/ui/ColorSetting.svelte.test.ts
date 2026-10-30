// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import ColorSetting from './ColorSetting.svelte';

test('opens the picker from its swatch', async () => {
  const user = userEvent.setup();
  render(ColorSetting, {
    label: 'Profile color',
    value: '',
    onCommit: vi.fn(),
    onReset: vi.fn(),
  });

  const trigger = screen.getByRole('button', { name: 'Choose Profile color' });
  await user.click(trigger);

  expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('a hex colour padded with spaces is committed trimmed', async () => {
  const user = userEvent.setup();
  const onCommit = vi.fn();
  render(ColorSetting, { label: 'Profile color', value: '', onCommit, onReset: vi.fn() });

  const input = screen.getByRole('textbox');
  await user.type(input, '#abc ');
  await user.tab();

  expect(onCommit).toHaveBeenCalledOnce();
  expect(input).toHaveValue('#abc');
});

test('changing hue keeps an achromatic color gray', async () => {
  const user = userEvent.setup();
  render(ColorSetting, {
    label: 'Profile color',
    value: '#808080',
    onCommit: vi.fn(),
    onReset: vi.fn(),
  });
  await user.click(screen.getByRole('button', { name: 'Choose Profile color' }));

  const hue = screen.getByRole('slider', { name: 'Profile color hue' });
  expect(hue).toHaveValue('0');
  await fireEvent.input(hue, { target: { value: '180' } });
  expect(screen.getByRole('textbox')).toHaveValue('#808080');
});

test('the hue endpoint wraps to uppercase red', async () => {
  const user = userEvent.setup();
  render(ColorSetting, {
    label: 'Profile color',
    value: '#f00',
    onCommit: vi.fn(),
    onReset: vi.fn(),
  });
  await user.click(screen.getByRole('button', { name: 'Choose Profile color' }));
  await fireEvent.input(screen.getByRole('slider'), { target: { value: '360' } });
  expect(screen.getByRole('textbox')).toHaveValue('#FF0000');
});

test('alpha hex retains the invalid-color picker default', async () => {
  const user = userEvent.setup();
  render(ColorSetting, {
    label: 'Profile color',
    value: '#abcd',
    onCommit: vi.fn(),
    onReset: vi.fn(),
  });
  await user.click(screen.getByRole('button', { name: 'Choose Profile color' }));
  await fireEvent.input(screen.getByRole('slider'), { target: { value: '240' } });
  expect(screen.getByRole('textbox')).toHaveValue('#0000FF');
});
