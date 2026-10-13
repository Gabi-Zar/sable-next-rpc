import { expect, SIGNED_OUT, test } from './fixtures/test';
import type { Locator } from '@playwright/test';

test.use({ storageState: SIGNED_OUT });

async function expectGlyphFillsDisc(badge: Locator): Promise<void> {
  await expect(badge).toBeVisible();
  const disc = await badge.boundingBox();
  const glyph = await badge.locator('svg').boundingBox();
  expect(glyph).toEqual(disc);
}

test('the join-rule badge glyph fills its disc on a bare room icon', async ({
  page,
  app,
  installRoomCore,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('sable-preferences', JSON.stringify({ showRoomIcon: 'never' }));
  });
  await installRoomCore('ready');
  await app.openRooms();
  await expectGlyphFillsDisc(page.locator('.room-icon .room-icon-badge').first());
});

test('the join-rule badge glyph fills its disc on a room avatar', async ({
  page,
  app,
  installRoomCore,
}) => {
  await installRoomCore('ready');
  await app.openRooms();
  await page.getByRole('button', { name: 'Jump to room' }).first().click();
  await expectGlyphFillsDisc(
    page.getByRole('dialog').locator('.avatar-fallback .room-icon-badge').first()
  );
});
