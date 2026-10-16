import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

vi.mock('#lib/platform/overlay-back.svelte.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/platform/overlay-back.svelte.js')>()),
  holdOverlayBack: () => {},
}));

import ScreenSharePickerDialog from './ScreenSharePickerDialog.svelte';

const thumbnail = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

const sources = [
  { id: 'screen:0:0', name: 'Screen 1', thumbnail },
  { id: 'window:1:0', name: 'A window with a title far too long to fit its tile', thumbnail },
  { id: 'window:2:0', name: 'Terminal', thumbnail },
];

test('the source list fits inside the dialog instead of scrolling sideways', async () => {
  await page.viewport(1100, 800);
  await render(ScreenSharePickerDialog, { sources, onShare: vi.fn(), onCancel: vi.fn() });

  const dialog = document.querySelector<HTMLElement>('.dialog-content');
  if (!dialog) throw new Error('dialog not rendered');

  await expect.poll(() => dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
});
