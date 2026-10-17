// @vitest-environment happy-dom

import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import { core as baseCore } from '#lib/core/__mocks__/context.js';
import { preferences } from '#lib/settings/preferences.svelte.js';

import JumpToTimeDialog from './JumpToTimeDialog.svelte';

vi.mock('#lib/core/context.js');

const timeline = Object.assign(baseCore.rpc.timeline, {
  timestampToEvent: vi.fn<(...args: never[]) => Promise<string | null>>(() =>
    Promise.resolve('$found')
  ),
  eventSource: vi.fn<(...args: never[]) => Promise<{ source: string }>>(() =>
    Promise.resolve({ source: '{"content":{}}' })
  ),
});

afterEach(() => {
  preferences.dateFormat = 'auto';
  preferences.hour24Clock = false;
});

test('shows the moment in the reader format and jumps on Enter', async () => {
  const user = userEvent.setup();
  preferences.dateFormat = 'ymd';
  preferences.hour24Clock = true;
  const onJump = vi.fn();
  render(JumpToTimeDialog, { open: true, roomId: '!r:x', onOpenChange: vi.fn(), onJump });

  const dialog = await screen.findByRole('dialog');
  const segments = [...dialog.querySelectorAll('[data-segment]')];
  expect(segments.slice(0, 5).map((segment) => segment.getAttribute('data-segment'))).toEqual([
    'year',
    'literal',
    'month',
    'literal',
    'day',
  ]);
  expect(dialog.querySelector('[data-segment="dayPeriod"]')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Today' }));
  dialog.querySelector<HTMLElement>('[data-segment="day"]')?.focus();
  await user.keyboard('{Enter}');

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  await vi.waitFor(() => {
    expect(onJump).toHaveBeenCalledWith('$found');
  });
  expect(timeline.timestampToEvent).toHaveBeenCalledWith({
    room_id: '!r:x',
    ts: midnight.getTime(),
    direction: 'forward',
  });
});

test('jumps to the thread root when the nearest event is a thread reply', async () => {
  const user = userEvent.setup();
  timeline.eventSource.mockResolvedValueOnce({
    source: JSON.stringify({
      content: { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
    }),
  });
  const onJump = vi.fn();
  render(JumpToTimeDialog, { open: true, roomId: '!r:x', onOpenChange: vi.fn(), onJump });

  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Today' }));
  await user.click(screen.getByRole('button', { name: 'Jump' }));

  await vi.waitFor(() => {
    expect(onJump).toHaveBeenCalledWith('$root');
  });
});
