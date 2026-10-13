import en from '../../src/locales/en.json' with { type: 'json' };
import { violations } from './fixtures/a11y';
import { LOGIN_PASSWORD, LOGIN_USERNAME } from './fixtures/loginAccount';
import { expect, test, SIGNED_OUT } from './fixtures/test';

test.use({ storageState: SIGNED_OUT });

test('sign-in has one stage group, no stage navigation landmark and a labelled create-account prompt', async ({
  auth,
  homeserver,
  page,
}) => {
  await auth.open(homeserver.baseUrl);
  await expect(auth.moreMethodsButton).toBeVisible({ timeout: 60_000 });

  await expect(page.getByRole('navigation', { name: en.auth.stageNavigation })).toHaveCount(0);
  await expect(page.getByRole('group', { name: en.auth.stageNavigation })).toHaveCount(1);
  await expect(page.getByText(en.auth.noAccountYet)).toBeVisible();
  await expect(page.getByRole('button', { name: en.auth.stageCreateAccountLabel })).toHaveCount(0);
});

test('Tab reaches the sign-in form before the stage buttons', async ({
  auth,
  homeserver,
  page,
}) => {
  await auth.open(homeserver.baseUrl);
  await expect(auth.moreMethodsButton).toBeVisible({ timeout: 60_000 });

  const order: string[] = [];
  for (let press = 0; press < 12; press += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(
        () =>
          document.activeElement?.getAttribute('aria-label') ??
          document.activeElement?.textContent.trim() ??
          ''
      )
    );
  }
  expect(order.indexOf(en.auth.next), order.join(' | ')).toBeGreaterThan(
    order.indexOf(en.auth.moreWaysToSignIn)
  );
});

test('setup exposes only the current step and has no violations', async ({
  auth,
  homeserver,
  page,
}) => {
  await auth.open(homeserver.baseUrl);
  await auth.revealPasswordLogin();
  await auth.signInWithPassword(LOGIN_USERNAME, LOGIN_PASSWORD);
  await expect(page).toHaveURL(/\/setup\/[a-z]+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  const stageButtons = [
    en.setup.stageDeviceLabel,
    en.auth.stageRecoveryLabel,
    en.setup.stageNotificationsLabel,
    en.setup.stageSyncLabel,
    en.setup.stageDoneLabel,
  ];
  for (const name of stageButtons) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  expect(await violations(page)).toEqual([]);
});
