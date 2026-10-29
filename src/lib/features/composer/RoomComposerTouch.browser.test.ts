import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';

import type { CoreClient } from '#lib/core/client.svelte.js';
import { createCoreStub } from '#lib/core/__mocks__/context.js';
import { setPreference } from '#lib/settings/preferences.svelte.js';

import en from '../../../locales/en.json' with { type: 'json' };
import Harness from './RoomComposerHarness.test.svelte';

afterEach(() => {
  document.documentElement.style.removeProperty('--keyboard-height');
  setPreference('composerForm', 'tall');
  setPreference('richTextComposer', true);
});

async function mountComposer() {
  const core = createCoreStub({
    commands: {
      roomMembers: () => Promise.resolve([]),
      fetchMedia: () => Promise.resolve(new Uint8Array()),
    },
    rpc: {
      messages: { mediaConfig: () => Promise.resolve({ upload_size: 100 * 1024 * 1024 }) },
      room_state: { botCommands: () => Promise.resolve([]) },
      personas: { list: () => Promise.resolve({ personas: [], selections: [] }) },
      packs: { list: () => Promise.resolve({ packs: [], complete: true }) },
    },
  }) as unknown as CoreClient;
  return render(Harness, {
    core,
    rooms: [],
    composer: {
      roomId: '!touch:example.org',
      onSend: () => Promise.resolve(),
      onSendAttachment: () => Promise.resolve(),
      onTyping: () => Promise.resolve(),
    },
  });
}

test('a multiline expanded composer fits above the landscape phone keyboard', async () => {
  await page.viewport(390, 844);
  setPreference('richTextComposer', true);
  setPreference('composerForm', 'tall');
  const screen = await mountComposer();
  const composer = screen.getByRole('combobox', { name: en.timeline.messagePlaceholder });
  await userEvent.click(screen.getByRole('button', { name: en.composer.expand }));
  await expect.poll(() => document.querySelector('.editor.expanded')).not.toBeNull();
  await page.viewport(844, 390);
  document.documentElement.style.setProperty('--keyboard-height', '190px');
  await userEvent.click(composer);
  const data = new DataTransfer();
  data.setData('text/plain', 'a line\n'.repeat(20));
  const editor = document.querySelector<HTMLElement>('.ProseMirror');
  if (!editor) throw new Error('the editor is not rendered');
  editor.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  );
  await expect.poll(() => document.querySelector('.composer-row.short')).not.toBeNull();
  await expect.poll(() => editor.textContent).toContain('a line');
  const row = document.querySelector('.composer-row') as HTMLElement;
  expect(row.getBoundingClientRect().height).toBeLessThan(100);
  const editorBox = editor.getBoundingClientRect();
  const send = screen
    .getByRole('button', { name: en.timeline.sendMessage })
    .element()
    .getBoundingClientRect();
  expect(send.height).toBeGreaterThanOrEqual(40);
  expect(send.top).toBeLessThan(editorBox.bottom);
  expect(send.bottom).toBeGreaterThan(editorBox.top);
});

test('opening the keyboard keeps the portrait composer readable', async () => {
  await page.viewport(390, 844);
  setPreference('composerForm', 'tall');
  const screen = await mountComposer();
  await userEvent.click(screen.getByRole('combobox', { name: en.timeline.messagePlaceholder }));
  await page.viewport(390, 400);
  await expect.poll(() => document.querySelector('.composer-row.short')).not.toBeNull();
  const row = document.querySelector<HTMLElement>('.composer-row.short');
  const editor = row?.querySelector<HTMLElement>('.editor');
  const controls = row?.querySelector<HTMLElement>('.composer-after');
  if (!row || !editor || !controls) throw new Error('Missing composer elements');
  expect(editor.getBoundingClientRect().width).toBeGreaterThan(
    row.getBoundingClientRect().width * 0.8
  );
  expect(controls.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    editor.getBoundingClientRect().bottom
  );
});
