import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import VoiceLobbyHarness from './VoiceLobbyHarness.test.svelte';

test.each([390, 1280])('join voice matches the dock controls at %spx', async (width) => {
  await page.viewport(width, 800);
  const screen = await render(VoiceLobbyHarness, {
    participants: [],
    members: [],
    media: { microphone: false, camera: false },
    joining: false,
    canJoin: true,
    hasPermission: true,
    onChange: vi.fn(),
    onJoin: vi.fn(),
    onOpenSettings: vi.fn(),
  });
  const join = screen.getByRole('button', { name: 'Join voice', exact: true }).element();
  const settings = screen.getByRole('button', { name: 'Call settings', exact: true }).element();
  const micTest = screen.getByRole('button', { name: 'Test mic', exact: true }).element();

  expect(join.getBoundingClientRect().height).toBe(settings.getBoundingClientRect().height);
  expect(getComputedStyle(join).borderRadius).toBe(getComputedStyle(settings).borderRadius);
  expect(join.getBoundingClientRect().height).toBe(micTest.getBoundingClientRect().height);
});
