// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import type { PersonaView } from '#src/generated/protocol';

vi.mock('#lib/core/context.js');

import PersonaEditor from './PersonaEditor.svelte';

const persona: PersonaView = {
  id: 'kris',
  display_name: 'Kris',
  avatar_url: null,
  pronouns: [],
  color_on_light: null,
  color_on_dark: null,
  triggers: [
    { prefix: 'k:', suffix: null, keep_trigger: false },
    { prefix: null, suffix: '-kr', keep_trigger: true },
  ],
  pluralkit: null,
  last_used: null,
};

test('removing a trigger keeps the remaining rows and saves them unchanged', async () => {
  const onSave = vi.fn(() => Promise.resolve());
  const user = userEvent.setup();
  render(PersonaEditor, { open: true, persona, onSave, onOpenChange: vi.fn() });

  const after = await screen.findAllByRole('textbox', { name: 'After' });
  const kept = after[1];
  expect(kept).toHaveValue('-kr');

  await user.click(screen.getAllByRole('button', { name: 'Remove this trigger' })[0]);

  expect(screen.getAllByRole('textbox', { name: 'After' })).toEqual([kept]);
  expect(kept).toHaveValue('-kr');

  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      triggers: [{ prefix: null, suffix: '-kr', keep_trigger: true }],
    }),
    'kris'
  );
});
