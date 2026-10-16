import { expect, test } from '@playwright/test';

import { installFakeCore } from './fake-core';

for (const width of [1280, 412]) {
  test(`call video quality persists independently at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installFakeCore(page, 'ready');
    await page.goto('/settings/calls');
    await expect(page.getByRole('heading', { name: 'Camera quality' })).toBeVisible({
      timeout: 30_000,
    });

    const choices = [
      ['Camera resolution', '360p', 'Automatic'],
      ['Camera maximum bitrate', '250 kbps', 'Automatic'],
      ['Camera codec', 'H.264', 'Automatic'],
      ['Screen sharing resolution', '1080p', '720p'],
      ['Screen sharing maximum bitrate', '1000 kbps', 'Automatic'],
      ['Screen sharing codec', 'VP9', 'Automatic'],
    ];
    for (const [name, value, initial] of choices) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control).toHaveText(initial);
      await control.click();
      await page.getByRole(width < 800 ? 'radio' : 'option', { name: value, exact: true }).click();
      await expect(control).toHaveText(value);
    }

    await page.reload();
    for (const [name, value] of choices) {
      const control = page.getByRole('button', { name, exact: true });
      await expect(control).toHaveText(value);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
  });
}
