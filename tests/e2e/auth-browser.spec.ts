import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer | undefined;
let origin: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { noDiscovery: true, entries: [] },
  });
  server.middlewares.use((req, res, next) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!['/test-auth', '/approval', '/callback'].includes(path)) {
      next();
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    if (path === '/approval') {
      res.end('<h1>Approve sign-in</h1>');
    } else if (path === '/callback') {
      res.end(`<script>
        const channel = new BroadcastChannel('auth-browser-test');
        channel.postMessage('complete');
        channel.close();
        window.close();
      </script>`);
    } else {
      res.end(`<button>Sign in</button><script type="module">
        import { openExternalAuthWindow } from '/src/lib/platform/external-auth.ts';
        const target = new URL(location.href).searchParams.get('target');
        document.querySelector('button').onclick = () => {
          const browser = openExternalAuthWindow('sable-auth-test');
          browser.navigate(target);
          document.addEventListener('auth-complete', () => browser.close(), { once: true });
          const channel = new BroadcastChannel('auth-browser-test');
          channel.onmessage = () => {
            document.dispatchEvent(new Event('auth-complete'));
            document.body.dataset.completed = 'true';
            channel.close();
          };
        };
        document.body.dataset.ready = 'true';
      </script>`);
    }
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  origin = `http://127.0.0.1:${String(address.port)}`;
});

test.afterAll(async () => {
  await server?.close();
});

test.beforeEach(async ({ page }) => {
  const approval = new URL('/approval', origin);
  approval.hostname = 'localhost';
  await page.goto(`${origin}/test-auth?target=${encodeURIComponent(approval.toString())}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
});

test('closes an approval popup after it navigates to another origin', async ({ page }) => {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const popup = await opened;
  await expect(popup.getByRole('heading')).toHaveText('Approve sign-in');
  await page.evaluate(() => document.dispatchEvent(new Event('auth-complete')));
  await expect.poll(() => popup.isClosed()).toBe(true);
});

test('delivers the OAuth callback and closes the popup after crossing origins', async ({
  page,
}) => {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in' }).click();
  const popup = await opened;
  await expect(popup.getByRole('heading')).toHaveText('Approve sign-in');
  await popup.goto(`${origin}/callback`, { waitUntil: 'commit' });
  await expect(page.locator('body')).toHaveAttribute('data-completed', 'true');
  await expect.poll(() => popup.isClosed()).toBe(true);
});
