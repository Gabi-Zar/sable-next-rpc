import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { expect, test, SIGNED_OUT } from './fixtures/test';
import { LOGIN_PASSWORD, LOGIN_USERNAME } from './fixtures/loginAccount';
import { homeserverStatePath } from './fixtures/runtime';
import { AppShell } from './pages/AppShell';
import { RoomTimeline } from './pages/RoomTimeline';
import { AuthFlow } from './pages/AuthFlow';
import { registerUser } from './fixtures/continuwuity';

test.use({ storageState: SIGNED_OUT });

const serverBinary = process.cwd() + '/target/debug/sable-server';
const testImage = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

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
  const reload = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).status()).toBe(204);
  await reload;
  await expect(page.getByRole('heading', { name: 'Sign in to Sable' })).toBeHidden({
    timeout: 30_000,
  });
  await expect(
    page
      .getByLabel('Account provider', { exact: true })
      .or(page.getByRole('button', { name: 'Switch account' }))
  ).toBeVisible({ timeout: 30_000 });
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

async function expectDecodedImage(image: import('@playwright/test').Locator): Promise<void> {
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0))
    .toBe(true);
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
  existingDataDir?: string,
  binary = serverBinary
): Promise<{
  port: number;
  origin: string;
  dataDir: string;
  process: ChildProcess;
  stop: () => Promise<void>;
}> {
  const port = existingPort ?? (await unusedPort());
  const dataDir = existingDataDir ?? (await mkdtemp(join(tmpdir(), 'sable-ws-restart-')));
  const serverProcess = spawn(binary, [], {
    env: {
      ...process.env,
      SABLE_SERVER_LISTEN_ADDR: '127.0.0.1:' + String(port),
      SABLE_SERVER_PUBLIC_URL: 'http://127.0.0.1:' + String(port),
      SABLE_SERVER_USERNAME: 'server',
      SABLE_SERVER_PASSWORD_HASH: passwordHash(),
      SABLE_SERVER_FRONTEND_DIR: process.cwd() + '/dist',
      SABLE_SERVER_DATA_DIR: dataDir,
      SABLE_SERVER_ALLOWED_PRIVATE_CIDRS: '["127.0.0.1/32"]',
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

  await page.locator('input[type="file"]').setInputFiles({
    name: 'server-mode.png',
    mimeType: 'image/png',
    buffer: testImage,
  });
  await app.composer.press('Enter');
  await expectDecodedImage(timeline.image.locator('img'));

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
    await expectDecodedImage(secondTimeline.image.locator('img'));
    const warmOpenMs = Math.round(performance.now() - warmStart);
    console.log(`open-ms cold=${String(coldOpenMs)} warm=${String(warmOpenMs)}`);
  } finally {
    await secondContext.close();
  }
  await signOutFromApp(page);
});

test('loads avatars and decrypts image attachments', async ({
  app,
  bootstrap,
  page,
  scratchRoom,
  signIn,
  timeline,
}) => {
  const avatar = await bootstrap.uploadMedia(testImage, 'image/png', 'avatar.png');
  await bootstrap.request(
    'PUT',
    `client/v3/profile/${encodeURIComponent(bootstrap.userId)}/avatar_url`,
    {
      avatar_url: avatar,
    }
  );
  await bootstrap.sendStateEvent(scratchRoom.roomId, 'm.room.avatar', '', { url: avatar });
  const plain = await bootstrap.sendImage(scratchRoom.roomId, avatar, {
    body: 'plain.png',
    width: 1,
    height: 1,
    size: testImage.length,
  });

  const key = randomBytes(32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-ctr', key, iv);
  const ciphertext = Buffer.concat([cipher.update(testImage), cipher.final()]);
  const url = await bootstrap.uploadMedia(ciphertext, 'application/octet-stream', 'encrypted');
  const encrypted = await bootstrap.sendEvent(scratchRoom.roomId, 'm.room.message', {
    msgtype: 'm.image',
    body: 'encrypted.png',
    file: {
      url,
      key: {
        kty: 'oct',
        alg: 'A256CTR',
        ext: true,
        key_ops: ['encrypt', 'decrypt'],
        k: key.toString('base64url'),
      },
      iv: iv.toString('base64').replace(/=+$/, ''),
      hashes: {
        sha256: createHash('sha256').update(ciphertext).digest('base64').replace(/=+$/, ''),
      },
      v: 'v2',
    },
    info: { mimetype: 'image/png', w: 1, h: 1, size: testImage.length },
  });

  await signInToServer(page);
  await signIn();
  const plainImage = timeline.itemByEventId(plain).getByAltText('plain.png', { exact: true });
  const encryptedImage = timeline
    .itemByEventId(encrypted)
    .getByAltText('encrypted.png', { exact: true });
  try {
    await app.openRoom(scratchRoom.roomId);
    await expectDecodedImage(page.locator('.room-avatar img').first());
    await expectDecodedImage(timeline.container.locator('.avatar-root img').first());
    await expectDecodedImage(plainImage);
    await expectDecodedImage(encryptedImage);

    await page.reload();
    await expectDecodedImage(page.locator('.room-avatar img').first());
    await expectDecodedImage(encryptedImage);
    await timeline
      .itemByEventId(encrypted)
      .getByRole('button', { name: 'Open encrypted.png' })
      .click();
    const viewer = page.getByRole('dialog', { name: 'Media viewer' });
    await expectDecodedImage(viewer.locator('.stage img'));
    const downloading = page.waitForEvent('download');
    await viewer.getByRole('button', { name: 'Download image' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('encrypted.png');
    const downloadedPath = await download.path();
    if (!downloadedPath) throw new Error('download did not produce a file');
    expect(await readFile(downloadedPath)).toEqual(testImage);
    await page.keyboard.press('Escape');
  } finally {
    await signOutFromApp(page);
  }
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
    await page.getByRole('button', { name: 'Log out of Sable server' }).click();
    await expect(page.getByRole('heading', { name: 'Sign in to Sable' })).toBeVisible();
    await signInToServer(page);
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

test('switching server users refreshes other tabs and isolates stored preferences', async ({
  browser,
}) => {
  const owned = await startOwnedServer();
  const userId = '7c230ca2-1285-4af9-8c18-fddcc321229e';
  await writeFile(
    join(owned.dataDir, 'users.json'),
    JSON.stringify({ users: [{ id: userId, username: 'alice', password_hash: passwordHash() }] })
  );
  const context = await browser.newContext({ baseURL: owned.origin, storageState: SIGNED_OUT });
  const first = await context.newPage();
  const second = await context.newPage();
  try {
    await signInToServer(first);
    await second.goto('/');
    await expect(second.getByLabel('Account provider', { exact: true })).toBeVisible();
    await expect
      .poll(async () =>
        first.evaluate(async () => {
          const identity = (await (await fetch('/_sable/identity')).json()) as { id: string };
          return identity.id;
        })
      )
      .toBe('legacy');
    await first.evaluate(() => {
      localStorage.setItem(
        'sable.server-user.legacy.sable.search.recent',
        '{"legacy":["private"]}'
      );
    });
    await first.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sable-notifications-legacy', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('room-names');
        request.onsuccess = () => {
          resolve(request.result);
        };
        request.onerror = () => {
          reject(request.error ?? new Error('IndexedDB request failed'));
        };
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('room-names', 'readwrite');
        transaction
          .objectStore('room-names')
          .put({ accessToken: 'private-token' }, '\u0000session:@a:example.org');
        transaction.oncomplete = () => {
          resolve();
        };
        transaction.onerror = () => {
          reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        };
      });
      database.close();
    });
    const navigation = first.waitForEvent('load');
    const status = await second.evaluate(
      async () =>
        (
          await fetch('/_sable/auth', {
            method: 'POST',
            headers: { Authorization: `Basic ${btoa('alice:password')}` },
          })
        ).status
    );
    expect(status).toBe(204);
    // Identity binding can reload this tab again before navigation finishes.
    await second.evaluate(() => {
      window.location.reload();
    });
    await navigation;
    await expect
      .poll(async () =>
        first.evaluate(async () => {
          const identity = (await (await fetch('/_sable/identity')).json()) as { id: string };
          return identity.id;
        })
      )
      .toBe(userId);
    await expect
      .poll(() =>
        first.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('sable-notifications-legacy', 1);
            request.onsuccess = () => {
              resolve(request.result);
            };
            request.onerror = () => {
              reject(request.error ?? new Error('IndexedDB request failed'));
            };
          });
          const value = await new Promise<unknown>((resolve, reject) => {
            const request = database
              .transaction('room-names')
              .objectStore('room-names')
              .get('\u0000session:@a:example.org');
            request.onsuccess = () => {
              resolve(request.result);
            };
            request.onerror = () => {
              reject(request.error ?? new Error('IndexedDB request failed'));
            };
          });
          database.close();
          return value === undefined;
        })
      )
      .toBe(true);
    expect(
      await first.evaluate(
        (id) => localStorage.getItem(`sable.server-user.${id}.sable.search.recent`),
        userId
      )
    ).toBeNull();
    await second.getByRole('button', { name: 'Log out of Sable server' }).click();
    await expect(first.getByRole('heading', { name: 'Sign in to Sable' })).toBeVisible();
    await expect(second.getByRole('heading', { name: 'Sign in to Sable' })).toBeVisible();
  } finally {
    await context.close();
    await owned.stop();
    await rm(owned.dataDir, { recursive: true, force: true });
  }
});

test('separate server users keep Matrix accounts and media isolated', async ({
  browser,
  homeserver,
}) => {
  let owned = await startOwnedServer();
  const id = '7c230ca2-1285-4af9-8c18-fddcc321229e';
  await writeFile(
    join(owned.dataDir, 'users.json'),
    JSON.stringify({ users: [{ id, username: 'alice', password_hash: passwordHash() }] })
  );
  const firstContext = await browser.newContext({
    baseURL: owned.origin,
    storageState: SIGNED_OUT,
  });
  const secondContext = await browser.newContext({
    baseURL: owned.origin,
    storageState: SIGNED_OUT,
  });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const accounts = (page: import('@playwright/test').Page) =>
    page.evaluate(
      () =>
        new Promise<unknown[]>((resolve, reject) => {
          const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/_sable/ws`);
          ws.onerror = () => {
            reject(new Error('socket failed'));
          };
          ws.onmessage = (event) => {
            const data = JSON.parse(String(event.data)) as {
              server?: unknown;
              id?: number;
              ok?: unknown[];
            };
            if (data.server)
              ws.send(JSON.stringify({ id: 42, method: 'session.list_accounts', params: {} }));
            if (data.id === 42) {
              ws.close();
              if (data.ok) resolve(data.ok);
              else reject(new Error('account list failed'));
            }
          };
        })
    );
  try {
    await signInToServer(first);
    await expect(first.getByLabel('Account provider', { exact: true })).toBeVisible();
    const auth = new AuthFlow(first);
    await auth.open(homeserver.baseUrl);
    await auth.revealPasswordLogin();
    await auth.signInWithPassword(LOGIN_USERNAME, LOGIN_PASSWORD);
    await auth.finishSetup();
    expect(await accounts(first)).toHaveLength(1);
    await second.goto('/');
    await second.getByLabel('Username', { exact: true }).fill('alice');
    await second.getByLabel('Password', { exact: true }).fill('password');
    await second.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(second.getByLabel('Account provider', { exact: true })).toBeVisible();
    expect(await accounts(second)).toEqual([]);
    const upload = await first.evaluate(async () => {
      const response = await fetch('/_sable/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: 'private attachment',
      });
      return response.ok ? ((await response.json()) as string) : null;
    });
    expect(upload).toMatch(/^mxc:\/\//);
    if (upload === null) throw new Error('upload failed');
    const mediaPath = `/_sable/media/${upload.slice('mxc://'.length)}`;
    const firstMedia = await first.evaluate(async (path) => {
      const response = await fetch(path);
      return { status: response.status, body: await response.text() };
    }, mediaPath);
    expect(firstMedia).toEqual({ status: 200, body: 'private attachment' });
    const secondMedia = await second.evaluate(
      async (path) => (await fetch(path)).status,
      mediaPath
    );
    expect(secondMedia).not.toBe(200);
    const username = `isolated-${Date.now()}`;
    await registerUser(homeserver.baseUrl, username, LOGIN_PASSWORD);
    const otherAuth = new AuthFlow(second);
    await otherAuth.open(homeserver.baseUrl);
    await otherAuth.revealPasswordLogin();
    await otherAuth.signInWithPassword(username, LOGIN_PASSWORD);
    await otherAuth.finishSetup();
    const otherAccounts = await accounts(second);
    expect(otherAccounts).toHaveLength(1);
    expect(JSON.stringify(otherAccounts)).not.toContain(LOGIN_USERNAME);
    const isolated = await second.evaluate(async () => {
      const response = await fetch('/_sable/media/example.org/not-owned', {
        headers: { 'x-sable-user': 'legacy' },
      });
      return response.status;
    });
    expect(isolated).toBe(403);
    await owned.stop();
    owned = await startOwnedServer(owned.port, owned.dataDir);
    await signInToServer(first);
    await expect.poll(async () => (await accounts(first)).length).toBe(1);
    await second.goto('/');
    await second.getByLabel('Username', { exact: true }).fill('alice');
    await second.getByLabel('Password', { exact: true }).fill('password');
    const loginResponse = second.waitForResponse(
      (response) =>
        response.url().endsWith('/_sable/auth') && response.request().method() === 'POST'
    );
    await second.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect((await loginResponse).status()).toBe(204);
    await expect
      .poll(async () => {
        try {
          return (await accounts(second)).length;
        } catch {
          return -1;
        }
      })
      .toBe(1);
    expect(JSON.stringify(await accounts(second))).not.toContain(LOGIN_USERNAME);
    const previousBinary = process.env.SABLE_TEST_PREVIOUS_SERVER_BIN;
    if (previousBinary) {
      await owned.stop();
      owned = await startOwnedServer(owned.port, owned.dataDir, previousBinary);
      await first.goto('/healthz');
      const status = await first.evaluate(
        async () =>
          (
            await fetch('/_sable/auth', {
              method: 'POST',
              headers: { Authorization: `Basic ${btoa('server:password')}` },
            })
          ).status
      );
      expect(status).toBe(204);
      expect(await accounts(first)).toHaveLength(1);
      await owned.stop();
      owned = await startOwnedServer(owned.port, owned.dataDir);
      await signInToServer(first);
      expect(await accounts(first)).toHaveLength(1);
      await second.goto('/');
      await second.getByLabel('Username', { exact: true }).fill('alice');
      await second.getByLabel('Password', { exact: true }).fill('password');
      const response = second.waitForResponse(
        (candidate) =>
          candidate.url().endsWith('/_sable/auth') && candidate.request().method() === 'POST'
      );
      await second.getByRole('button', { name: 'Sign in', exact: true }).click();
      expect((await response).status()).toBe(204);
      await expect
        .poll(async () => {
          try {
            return (await accounts(second)).length;
          } catch {
            return -1;
          }
        })
        .toBe(1);
      expect(JSON.stringify(await accounts(second))).not.toContain(LOGIN_USERNAME);
    }
  } finally {
    await firstContext.close();
    await secondContext.close();
    await owned.stop();
    await rm(owned.dataDir, { recursive: true, force: true });
  }
});
