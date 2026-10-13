// Tab-stop budgets and per-page axe runs for #960. A test.fail() marks a gap the
// issue describes: it turns red once the gap closes, so the annotation gets removed.

import { violations, tabStops } from './fixtures/a11y';
import { TIMELINE_ROOM_NAME } from './fixtures/continuwuity';
import { expect, test, SIGNED_OUT } from './fixtures/test';

test.use({ storageState: SIGNED_OUT });

test.beforeEach(async ({ page, signIn }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn();
});

test('every settings category has no accessibility violations', async ({ page }) => {
  await page.goto('/settings/appearance');
  await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();

  const categories = await page
    .locator('a[href^="/settings/"]')
    .evaluateAll((links) => [
      ...new Set(
        links
          .map((link) => link.getAttribute('href') ?? '')
          .filter((href) => /^\/settings\/[\w-]+$/.test(href))
      ),
    ]);
  expect(categories.length).toBeGreaterThan(3);

  const failing: Record<string, string[]> = {};
  for (const href of categories) {
    await page.goto(href);
    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    const found = await violations(page);
    if (found.length) failing[href] = found.map((violation) => violation.id);
  }
  expect(failing).toEqual({});
});

test.describe('room view tab stops', () => {
  test.beforeEach(async ({ app, homeserver, page, timeline }) => {
    await app.openRooms();
    await expect(app.roomLink(TIMELINE_ROOM_NAME)).toBeVisible({ timeout: 15_000 });
    await app.openRoom(homeserver.timelineRoomId);
    await expect(timeline.items.first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('the room header actions are one tab stop', async ({ page }) => {
    const toolbar = page.getByRole('toolbar', { name: 'Room actions' });
    const stops = await tabStops(toolbar);
    expect(stops, stops.join('\n')).toHaveLength(1);

    await toolbar.getByRole('button').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button').nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(toolbar.getByRole('button').last()).toBeFocused();
  });

  test('the timeline is one tab stop', async ({ page }) => {
    test.fail(true, '#960: every message and its actions are tab stops');
    const stops = await tabStops(page.getByRole('log'));
    expect(stops, stops.join('\n')).toHaveLength(1);
  });

  test('the room list is one tab stop', async ({ page }) => {
    test.fail(true, '#960: rooms and spaces should be a tree with one tab stop');
    const list = page.getByRole('navigation', { name: 'Primary navigation' });
    const stops = await tabStops(list);
    expect(stops, stops.join('\n')).toHaveLength(1);
  });
});
