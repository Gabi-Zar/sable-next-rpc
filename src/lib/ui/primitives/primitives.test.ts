// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import Avatar from './Avatar.svelte';
import Button from './Button.svelte';
import OptionCards from './OptionCards.svelte';
import Spinner from './Spinner.svelte';

test('a loading button is disabled and busy', () => {
  render(Button, { variant: 'primary', loading: true, block: true });

  const button = screen.getByRole('button');
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
});

test('decorative avatars stay out of the accessibility tree', () => {
  const { container } = render(Avatar, { initials: 'S', decorative: true });

  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(container.querySelector('.avatar-root')).toHaveAttribute('aria-hidden', 'true');
});

test('option cards are one radio group with a single checked item', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(OptionCards, {
    label: 'Visibility',
    value: 'private',
    onSelect,
    options: [
      { value: 'private', label: 'Private', hint: 'Invite only' },
      { value: 'public', label: 'Public' },
      { value: 'space', label: 'Space', disabled: true },
    ],
  });

  expect(screen.getByRole('radiogroup', { name: 'Visibility' })).toBeInTheDocument();
  const radios = screen.getAllByRole('radio');
  expect(radios).toHaveLength(3);
  expect(screen.getByRole('radio', { checked: true })).toHaveAccessibleName(/Private/);
  expect(screen.getByRole('radio', { name: 'Space' })).toHaveAttribute('data-disabled');
  expect(radios.filter((radio) => radio.getAttribute('tabindex') !== '-1')).toHaveLength(1);

  await user.click(screen.getByRole('radio', { name: 'Public' }));

  expect(onSelect).toHaveBeenCalledWith('public');
});

test('a labelled spinner announces loading without exposing the glyph', () => {
  const { container } = render(Spinner, { label: 'Loading' });

  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(container.querySelector('.spinner')).toHaveAttribute('aria-hidden', 'true');
});

test('an unlabelled spinner stays a decorative glyph', () => {
  const { container } = render(Spinner);

  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container.querySelector('.spinner')).toHaveAttribute('aria-hidden', 'true');
});
