import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { expect, test, SIGNED_OUT } from './fixtures/test';
import { LOGIN_PASSWORD, LOGIN_USERNAME } from './fixtures/loginAccount';
import { homeserverStatePath } from './fixtures/runtime';
import { AppShell } from './pages/AppShell';
import { RoomTimeline } from './pages/RoomTimeline';

test.use({ storageState: SIGNED_OUT });

const serverBinary = process.cwd() + '/target/debug/sable-server';
function passwordHash(): string {
  return execFileSync(serverBinary, ['hash-password'], {
    input: 'password\n',
    encoding: 'utf8',
  }).trim();
}

async function signInToServer(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('heading', { name: 'Sign in to Sable' }).waitFor();
  await page.getByLabel('Username', { exact: true }).fill('server');
  await page.getByLabel('Password', { exact: true }).fill('password');
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith('/_sable/auth') && candidate.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(204);
  await expect(page.getByRole('heading', { name: 'Sign in to Sable' })).toBeHidden({
    timeout: 30_000,
  });
}

async function signOutFromApp(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Log out' }).click();
  await page
    .getByRole('dialog', { name: 'Log out', exact: true })
    .getByRole('button', { name: 'Log out' })
    .click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('could not reserve a port');
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return port;
}

async function startOwnedServer(
  existingPort?: number,
  existingDataDir?: string
): Promise<{
  port: number;
  origin: string;
  dataDir: string;
  process: ChildProcess;
  stop: () => Promise<void>;
}> {
  const port = existingPort ?? (await unusedPort());
  const dataDir = existingDataDir ?? (await mkdtemp(join(tmpdir(), 'sable-ws-restart-')));
  const serverProcess = spawn(serverBinary, [], {
    env: {
      ...process.env,
      SABLE_SERVER_LISTEN_ADDR: '127.0.0.1:' + String(port),
      SABLE_SERVER_PUBLIC_URL: 'http://127.0.0.1:' + String(port),
      SABLE_SERVER_USERNAME: 'server',
      SABLE_SERVER_PASSWORD_HASH: passwordHash(),
      SABLE_SERVER_FRONTEND_DIR: process.cwd() + '/dist',
      SABLE_SERVER_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const origin = 'http://127.0.0.1:' + String(port);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(origin + '/healthz')).ok) {
        return {
          port,
          origin,
          dataDir,
          process: serverProcess,
          stop: async () => {
            if (serverProcess.exitCode !== null) return;
            serverProcess.kill('SIGTERM');
            await new Promise<void>((resolve) => {
              serverProcess.once('exit', () => {
                resolve();
              });
            });
          },
        };
      }
    } catch {
      // The owned process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  serverProcess.kill('SIGTERM');
  throw new Error('owned server did not become healthy');
}

test('logs in, sends a message, and shows it in a second server client', async ({
  app,
  browser,
  page,
  scratchRoom,
  signIn,
  timeline,
}) => {
  const coldStart = performance.now();
  await signInToServer(page);
  await signIn();
  await app.openRoom(scratchRoom.roomId);
  await expect(app.roomHeading(scratchRoom.name)).toBeVisible();
  const coldOpenMs = Math.round(performance.now() - coldStart);
  if (process.env.SABLE_WS_E2E_SINGLE_CLIENT === '1') {
    const warmStart = performance.now();
    await app.openRoom(scratchRoom.roomId);
    const warmOpenMs = Math.round(performance.now() - warmStart);
    console.log(`open-ms cold=${String(coldOpenMs)} warm=${String(warmOpenMs)}`);
    return;
  }

  const body = `Server mode ${String(Date.now())}`;
  await app.composer.fill(body);
  await app.composer.press('Enter');
  await timeline.expectMessageSettled(body);

  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'server-mode.png',
    mimeType: 'image/png',
    buffer: image,
  });
  await app.composer.press('Enter');
  await expect(timeline.image).toBeVisible({ timeout: 30_000 });

  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: SIGNED_OUT,
  });
  const secondPage = await secondContext.newPage();
  const secondApp = new AppShell(secondPage);
  const secondTimeline = new RoomTimeline(secondPage);
  try {
    await signInToServer(secondPage);
    const warmStart = performance.now();
    await secondApp.openRoom(scratchRoom.roomId);
    await expect(secondApp.roomHeading(scratchRoom.name)).toBeVisible();
    await expect(secondTimeline.message(body)).toBeVisible({ timeout: 30_000 });
    await expect(secondTimeline.image).toBeVisible({ timeout: 30_000 });
    const warmOpenMs = Math.round(performance.now() - warmStart);
    console.log(`open-ms cold=${String(coldOpenMs)} warm=${String(warmOpenMs)}`);
  } finally {
    await secondContext.close();
  }
  await signOutFromApp(page);
});

test('logs in through OAuth, opens a room, and sends a message', async ({
  app,
  auth,
  page,
  scratchRoom,
  timeline,
}) => {
  const { baseUrl } = JSON.parse(await readFile(homeserverStatePath(), 'utf8')) as {
    baseUrl: string;
  };

  await signInToServer(page);
  await auth.open(baseUrl);
  await auth.revealMoreMethods();

  const popup = page.waitForEvent('popup');
  await auth.redirectSignInButton.click();
  const provider = await popup;
  await provider.locator('#identifier').fill(LOGIN_USERNAME);
  await provider.locator('#password').fill(LOGIN_PASSWORD);
  await provider.getByRole('button', { name: 'Log in' }).click();
  await provider.getByRole('button', { name: 'Continue' }).click();

  await auth.finishSetup();
  await app.openRoom(scratchRoom.roomId);
  await expect(app.roomHeading(scratchRoom.name)).toBeVisible();
  const body = `Server OAuth ${String(Date.now())}`;
  await app.composer.fill(body);
  await app.composer.press('Enter');
  await timeline.expectMessageSettled(body);
  await signOutFromApp(page);
});

test('a server restart resets the session and permits recovery', async ({ browser }) => {
  const owned = await startOwnedServer();
  const context = await browser.newContext({
    baseURL: owned.origin,
    storageState: SIGNED_OUT,
  });
  const page = await context.newPage();
  try {
    await signInToServer(page);
    await expect(page.getByRole('combobox', { name: 'Account provider' })).toBeVisible();
    await owned.stop();
    const restarted = await startOwnedServer(owned.port, owned.dataDir);
    try {
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Sign in to Sable' })).toBeVisible();
      await signInToServer(page);
      await expect(page.getByRole('combobox', { name: 'Account provider' })).toBeVisible();
    } finally {
      await restarted.stop();
      await rm(restarted.dataDir, { recursive: true, force: true });
    }
  } finally {
    await context.close();
    await owned.stop();
    await rm(owned.dataDir, { recursive: true, force: true });
  }
});
